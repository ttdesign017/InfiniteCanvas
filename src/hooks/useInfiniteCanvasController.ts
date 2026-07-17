import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { pruneEmbedIframes } from '../utils/embedIframeCache'
import type { SnapGuide } from '../utils/snap'
import { type DragMode } from './canvas'
import { useCanvasSurfaceModel } from './canvas/useCanvasSurfaceModel'
import { useDragWriteScheduler } from './canvas/useDragWriteScheduler'
import { useModalTransformHotkeys } from './canvas/useModalTransformHotkeys'
import { useStackNavGhosts } from './canvas/useStackNavGhosts'
import { useCanvasPointerGestures } from './canvas/useCanvasPointerGestures'
import {
  blurChrome,
  dismissStackNameEdit,
  isInteractionLocked,
} from './canvas/canvasUiHelpers'

export { captureJointMoveSelection } from './canvas'

/**
 * Infinite canvas interaction shell: composes surface model, nav ghosts,
 * modal G/R/S, and pointer gestures. Gesture logic lives in
 * {@link useCanvasPointerGestures}.
 */
export function useInfiniteCanvasController() {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragMode>(null)
  const eraseHistoryPushed = useRef(false)
  const lastItemClickRef = useRef<{
    id: string
    t: number
    x: number
    y: number
  } | null>(null)
  const [marquee, setMarquee] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [cropOverlay, setCropOverlay] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([])
  const [stackDropTargetId, setStackDropTargetId] = useState<string | null>(
    null,
  )
  const stackDropTargetRef = useRef<string | null>(null)

  const setStackDropTarget = useCallback((gid: string | null) => {
    stackDropTargetRef.current = gid
    setStackDropTargetId(gid)
  }, [])

  const { scheduleDragWrite, flushDragWrite } = useDragWriteScheduler()
  const { modalXformKind } = useModalTransformHotkeys({ setSnapGuides })

  const items = useCanvasStore((s) => s.items)
  const stacks = useCanvasStore((s) => s.stacks)
  const currentContainerId = useCanvasStore((s) => s.currentContainerId)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const selectedStackIds = useCanvasStore((s) => s.selectedStackIds)
  const viewport = useCanvasStore((s) => s.viewport)
  const tool = useCanvasStore((s) => s.tool)
  const spaceHeld = useCanvasStore((s) => s.spaceHeld)
  const cHeld = useCanvasStore((s) => s.cHeld)
  const isPanning = useCanvasStore((s) => s.isPanning)
  const stackEnterAnim = useCanvasStore((s) => s.stackEnterAnim)
  const setStackEnterAnim = useCanvasStore((s) => s.setStackEnterAnim)

  useEffect(() => {
    const live = new Set(
      items.filter((i) => i.type === 'embed').map((i) => i.id),
    )
    pruneEmbedIframes(live)
  }, [items])

  const {
    visibleItems,
    visibleStacks,
    sortedNonEmbeds,
    allEmbedItems,
    selectedSet,
    selectedStackSet,
    isGroupSelect,
    groupBounds,
    effectiveTool,
    stackFolders,
    stackPreviewItems,
  } = useCanvasSurfaceModel({
    items,
    stacks,
    currentContainerId,
    selectedIds,
    selectedStackIds,
    stackDropTargetId,
    tool,
    spaceHeld,
    cHeld,
  })

  const navGhosts = useStackNavGhosts({
    items,
    stacks,
    currentContainerId,
    stackEnterAnim,
  })

  useEffect(() => {
    if (!stackEnterAnim) return
    if (stackEnterAnim.mode === 'exit') return
    const startSnap = { ...stackEnterAnim.start }
    const stackId = stackEnterAnim.stackId
    const name = stackEnterAnim.name
    const memberCount = stackEnterAnim.memberCount
    const t0 = performance.now()
    const morphDur = 380
    const peerFadeDur = 500
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / morphDur)
      const e = 1 - Math.pow(1 - t, 3)
      const nestedChromeOpacity = Math.max(0, Math.min(1, (e - 0.15) / 0.85))
      const pu = Math.max(0, Math.min(1, (now - t0) / peerFadeDur))
      const peerReveal = 1 - pu * pu * (3 - 2 * pu)
      useCanvasStore.getState().setStackEnterAnim({
        stackId,
        mode: 'enter',
        start: startSnap,
        t: e,
        nestedChromeOpacity,
        peerReveal,
        name,
        memberCount,
      })
      if (t < 1 || pu < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        setStackEnterAnim(null)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stackEnterAnim?.stackId,
    stackEnterAnim?.mode,
    stackEnterAnim?.start.x,
    stackEnterAnim?.start.y,
  ])

  const getLocalPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    }
  }, [])

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const store = useCanvasStore.getState()
      const rect = el.getBoundingClientRect()
      const local = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const looksLikeTrackpad =
        Math.abs(e.deltaX) > 0.5 && Math.abs(e.deltaY) > 0.5
      if (e.ctrlKey || e.metaKey) {
        store.zoomAt(local.x, local.y, Math.exp(-e.deltaY * 0.01))
      } else if (e.shiftKey) {
        store.panBy(-e.deltaY - e.deltaX, 0)
      } else if (looksLikeTrackpad || e.altKey) {
        store.panBy(-e.deltaX, -e.deltaY)
      } else {
        store.zoomAt(local.x, local.y, Math.exp(-e.deltaY * 0.0025))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const {
    onGroupScalePointerDown,
    onResizePointerDown,
    onItemPointerDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
  } = useCanvasPointerGestures({
    surfaceRef,
    dragRef,
    eraseHistoryPushed,
    lastItemClickRef,
    stackDropTargetRef,
    setStackDropTarget,
    setMarquee,
    setCropOverlay,
    setDropActive,
    setSnapGuides,
    scheduleDragWrite,
    flushDragWrite,
    getLocalPoint,
    effectiveTool,
    isGroupSelect,
    selectedSet,
    selectedStackSet,
    visibleItems,
    currentContainerId,
  })

  const cursor =
    modalXformKind === 'grab'
      ? 'grabbing'
      : modalXformKind === 'rotate' || modalXformKind === 'scale'
        ? 'crosshair'
        : effectiveTool === 'pan' || spaceHeld
          ? isPanning
            ? 'grabbing'
            : 'grab'
          : effectiveTool === 'crop'
            ? 'crosshair'
            : effectiveTool === 'scribble' || effectiveTool === 'erase'
              ? 'crosshair'
              : effectiveTool === 'text' ||
                  effectiveTool === 'textcard' ||
                  effectiveTool === 'link'
                ? 'cell'
                : 'default'

  const {
    animStackRec,
    animParentId,
    exitingStackId,
    exitGhostParent,
    enterGhostParent,
    exitPeerOpacity,
    exitAfterHandoff,
    parentPeerGhostItems,
    parentPeerGhostStacks,
    parentPeerGhostStackIds,
    exitParentPeerStackIds,
    navPeerOpacity,
  } = navGhosts

  return {
    surfaceRef,
    dragRef,
    marquee,
    cropOverlay,
    dropActive,
    snapGuides,
    modalXformKind,
    items,
    stacks,
    currentContainerId,
    selectedStackIds,
    viewport,
    tool,
    cHeld,
    stackEnterAnim,
    visibleItems,
    visibleStacks,
    sortedNonEmbeds,
    allEmbedItems,
    selectedSet,
    selectedStackSet,
    isGroupSelect,
    groupBounds,
    stackFolders,
    stackPreviewItems,
    flushDragWrite,
    blurChrome,
    isInteractionLocked,
    dismissStackNameEdit,
    onGroupScalePointerDown,
    onResizePointerDown,
    onItemPointerDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    cursor,
    animStackRec,
    animParentId,
    exitingStackId,
    exitGhostParent,
    enterGhostParent,
    exitPeerOpacity,
    exitAfterHandoff,
    parentPeerGhostItems,
    parentPeerGhostStacks,
    parentPeerGhostStackIds,
    exitParentPeerStackIds,
    navPeerOpacity,
  }
}
