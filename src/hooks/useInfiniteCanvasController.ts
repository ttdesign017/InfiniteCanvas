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
import { useWorldCullRect } from './canvas/useWorldCullRect'
import {
  resetStackAnimProgress,
  setStackAnimProgress,
} from '../utils/stackAnimProgress'
import { diagError, diagInfo } from '../utils/diagLog'
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
  // Viewport is NOT subscribed here — CanvasWorldTransform owns pan/zoom so
  // item layers do not re-render on every wheel tick.
  const tool = useCanvasStore((s) => s.tool)
  const spaceHeld = useCanvasStore((s) => s.spaceHeld)
  const cHeld = useCanvasStore((s) => s.cHeld)
  const isPanning = useCanvasStore((s) => s.isPanning)
  const stackEnterAnim = useCanvasStore((s) => s.stackEnterAnim)
  const setStackEnterAnim = useCanvasStore((s) => s.setStackEnterAnim)
  const animating = useCanvasStore((s) => s.animating)

  useEffect(() => {
    const live = new Set(
      items.filter((i) => i.type === 'embed').map((i) => i.id),
    )
    pruneEmbedIframes(live)
  }, [items])

  // Cull during normal editing; keep full tree during stack enter/exit morph.
  const cullRect = useWorldCullRect({
    disabled: !!(stackEnterAnim || animating),
    marginPx: 280,
  })

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
    cullRect,
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
    // Morph/peer progress only — do not rewrite Zustand stackEnterAnim each frame
    diagInfo('enterMorph', 'start', {
      stackId: stackEnterAnim.stackId,
      start: stackEnterAnim.start,
    })
    const t0 = performance.now()
    const morphDur = 380
    const peerFadeDur = 500
    let raf = 0
    const tick = (now: number) => {
      try {
        const t = Math.min(1, (now - t0) / morphDur)
        const e = 1 - Math.pow(1 - t, 3)
        const nestedChromeOpacity = Math.max(0, Math.min(1, (e - 0.15) / 0.85))
        const pu = Math.max(0, Math.min(1, (now - t0) / peerFadeDur))
        const peerReveal = 1 - pu * pu * (3 - 2 * pu)
        setStackAnimProgress({
          t: e,
          nestedChromeOpacity,
          peerReveal,
          settle: 0,
        })
        if (t < 1 || pu < 1) {
          raf = requestAnimationFrame(tick)
        } else {
          resetStackAnimProgress()
          setStackEnterAnim(null)
          diagInfo('enterMorph', 'complete', {
            stackId: stackEnterAnim.stackId,
          })
        }
      } catch (err) {
        diagError('enterMorph', 'tick failed', err)
        resetStackAnimProgress()
        try {
          setStackEnterAnim(null)
        } catch {
          /* ignore */
        }
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
    peerScatterOriginLocal,
    peerScatterOriginWorld,
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
    peerScatterOriginLocal,
    peerScatterOriginWorld,
  }
}
