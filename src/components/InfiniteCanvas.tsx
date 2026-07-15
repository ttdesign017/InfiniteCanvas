import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { CanvasItemView } from './items/CanvasItemView'
import { EmptyState } from './EmptyState'
import { StackFolder } from './StackFolder'
import type {
  CanvasItem,
  EmbedItem,
  MediaItem,
  StackRecord,
} from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import {
  expandStackSelection,
  hitStackGroupAt,
  placeItemsTight,
  screenToWorld,
  stackCollapsedSnapBounds,
  stackGroupBounds,
} from '../utils/layout'
import {
  collapsedStackFanCards,
  collapsedStackFolderBounds,
  collectItemsInStackTree,
  containerOf,
  countLeafItemsInStack,
  itemsInContainer,
  migrateLegacyStacks,
} from '../utils/stacks'
import { pruneEmbedIframes } from '../utils/embedIframeCache'
import {
  embedDisplayItem,
  resolveEmbedWorldPose,
} from '../utils/embedPose'
import { createMediaFromFile, createMediaFromPath } from '../utils/media'
import { importDropAt } from '../utils/dropImport'
import { computeResize, isEdgeResizeType } from '../utils/resize'
import {
  computeSnapDelta,
  guidesEqual,
  snapResizeRect,
  type SnapGuide,
} from '../utils/snap'
import { isDesktop, onNativeFileDrop, openExternal } from '../utils/desktop'
import {
  clearTextScalePreview,
  getTextScalePreview,
  originFromHandle,
  scaledBoxFromPreview,
  setTextScalePreview,
} from '../utils/textScalePreview'
import {
  applyModalTransform,
  beginModalTransform,
  type ModalTransformSession,
} from '../utils/modalTransform'
import {
  applyGroupScale,
  computeSelectionBounds,
  groupFactorFromSnappedBox,
  groupScaleFactor,
  groupScaledBounds,
  isGroupScalableType,
  type GroupBodyOrigin,
  type GroupScaleHandle,
} from '../utils/selectionBounds'
import { marqueeHitsRotatedItem, pointInRotatedItem } from '../utils/geometry'
import { isAxisAlignedForCrop } from '../utils/crop'

/** Screen px before a press becomes a real drag (preserves double-click edit) */
const DRAG_THRESHOLD_PX = 5

type DragMode =
  | null
  | { kind: 'pan'; lastX: number; lastY: number }
  | {
      /** Click vs drag: not yet moved past threshold — no history / no position write */
      kind: 'pending-move'
      itemId: string
      isStacked: boolean
      stackGroupId?: string
      canEditText: boolean
      /** Link double-click open (pointer-capture often kills native dblclick) */
      canOpenLink?: boolean
      linkUrl?: string
      startClientX: number
      startClientY: number
      lastX: number
      lastY: number
      ids: string[]
      origins: Record<string, { x: number; y: number }>
      stackIds?: string[]
      stackOrigins?: Record<string, { x: number; y: number }>
      duplicated: boolean
      altHeld: boolean
    }
  | {
      kind: 'move'
      ids: string[]
      /** Nested stack folder ids being moved on this canvas */
      stackIds?: string[]
      stackOrigins?: Record<string, { x: number; y: number }>
      lastX: number
      lastY: number
      moved: boolean
      /** Alt-drag duplicate already performed */
      duplicated: boolean
      altHeld: boolean
      /** Positions at drag start (pre-snap free tracking) */
      origins: Record<string, { x: number; y: number }>
      accDx: number
      accDy: number
    }
  | {
      kind: 'marquee'
      startX: number
      startY: number
      x: number
      y: number
      w: number
      h: number
      additive: boolean
    }
  | {
      kind: 'resize'
      id: string
      handle: string
      startX: number
      startY: number
      orig: { x: number; y: number; width: number; height: number }
      /** note/link/text edges → single side; media → uniform scale */
      edgeMode: 'scale' | 'edge'
      isMedia: boolean
      /** Free text: corners also scale fontSize */
      isText: boolean
      origFontSize?: number
      /** Last Shift-scale factor (survives preview clear race) */
      lastTextScale?: number
      /** True if last move used text live CSS scale path */
      textScaleActive?: boolean
    }
  | {
      /** Multi-selection proportional scale from a corner of the group bbox */
      kind: 'group-scale'
      handle: GroupScaleHandle
      bounds: { x: number; y: number; width: number; height: number }
      bodies: GroupBodyOrigin[]
    }
  | { kind: 'scribble'; id: string }
  | { kind: 'erase'; erased: boolean }
  | {
      kind: 'crop'
      /** One or more free media (non-rotated) to crop with the same marquee */
      ids: string[]
      startWorld: { x: number; y: number }
      currentWorld: { x: number; y: number }
    }
  | {
      kind: 'create-note'
      startWorld: { x: number; y: number }
      startLocal: { x: number; y: number }
      x: number
      y: number
      w: number
      h: number
    }

/** Free items + stacks currently selected on the active canvas, for joint drag. */
function captureJointMoveSelection(store: {
  items: import('../types/canvas').CanvasItem[]
  stacks: import('../types/canvas').StackRecord[]
  selectedIds: string[]
  selectedStackIds: string[]
  currentContainerId: string
}): {
  ids: string[]
  origins: Record<string, { x: number; y: number }>
  stackIds: string[]
  stackOrigins: Record<string, { x: number; y: number }>
} {
  const ids = expandStackSelection(store.selectedIds, store.items).filter(
    (id) => {
      const it = store.items.find((i) => i.id === id)
      if (!it || it.stacked) return false
      return containerOf(it) === store.currentContainerId
    },
  )
  const origins: Record<string, { x: number; y: number }> = {}
  for (const id of ids) {
    const it = store.items.find((i) => i.id === id)
    if (it) origins[id] = { x: it.x, y: it.y }
  }
  const stackIds = store.selectedStackIds.filter((sid) => {
    const st = store.stacks.find((s) => s.id === sid)
    return !!st && st.parentId === store.currentContainerId
  })
  const stackOrigins: Record<string, { x: number; y: number }> = {}
  for (const sid of stackIds) {
    const st = store.stacks.find((s) => s.id === sid)
    if (st) stackOrigins[sid] = { x: st.x, y: st.y }
  }
  return { ids, origins, stackIds, stackOrigins }
}

function isMedia(item: CanvasItem): item is MediaItem {
  return item.type === 'image' || item.type === 'gif' || item.type === 'video'
}

/**
 * Free media on the *current* canvas only.
 * Critical: nested stack members keep free poses in their own container space —
 * treating those x/y as world would hit the wrong image and crop stacks.
 */
function freeMediaOnCanvas(
  items: CanvasItem[],
  containerId: string,
): MediaItem[] {
  return items
    .filter(isMedia)
    .filter((m) => !m.stacked && containerOf(m) === containerId)
    .sort((a, b) => b.zIndex - a.zIndex)
}

/**
 * Crop targets: free image/gif/video on current canvas only.
 * - Multi-select free media → all selected free media (rotated ones filtered out)
 * - Single / none → media under cursor, else the single selected free media
 * Rotated media cannot crop; if every candidate is rotated, rotatedOnly=true for toast.
 */
function resolveCropTargets(
  world: { x: number; y: number },
  items: CanvasItem[],
  selectedIds: string[],
  selectedStackIds: string[],
  containerId: string,
): { ids: string[]; rotatedOnly: boolean } {
  const free = freeMediaOnCanvas(items, containerId)
  const selectedMedia = free.filter((i) => selectedIds.includes(i.id))

  let candidates: MediaItem[] = []

  if (selectedMedia.length >= 2) {
    // Multi free-media selection: crop all of them together (ignore rotated later)
    candidates = selectedMedia
  } else {
    // Prefer hit under cursor (selected first, then any free media)
    let hit: MediaItem | null = null
    for (const m of selectedMedia) {
      if (pointInRotatedItem(world, m)) {
        hit = m
        break
      }
    }
    if (!hit) {
      for (const m of free) {
        if (pointInRotatedItem(world, m)) {
          hit = m
          break
        }
      }
    }
    if (hit) {
      candidates = [hit]
    } else if (selectedMedia.length === 1) {
      // Crop-from-outside with one selected free media
      candidates = selectedMedia
    } else {
      // Only stacks / non-media / empty
      return { ids: [], rotatedOnly: false }
    }
  }

  const axis = candidates.filter(isAxisAlignedForCrop)
  if (axis.length > 0) {
    return { ids: axis.map((m) => m.id), rotatedOnly: false }
  }
  // All candidates are rotated
  if (candidates.length > 0) {
    return { ids: [], rotatedOnly: true }
  }
  void selectedStackIds
  return { ids: [], rotatedOnly: false }
}

const CROP_ROTATED_HINT = "Can't crop while rotated — Alt+R first"

export function InfiniteCanvas() {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragMode>(null)
  const eraseHistoryPushed = useRef(false)
  /** Coalesce store writes during drag/resize to one per animation frame */
  const dragRafRef = useRef(0)
  const pendingDragWriteRef = useRef<(() => void) | null>(null)
  /** Double-click detector (works even when first press was a pending-move) */
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
  /** Stack group under free-item drag (merge target) */
  const [stackDropTargetId, setStackDropTargetId] = useState<string | null>(
    null,
  )
  const stackDropTargetRef = useRef<string | null>(null)

  const setStackDropTarget = useCallback((gid: string | null) => {
    stackDropTargetRef.current = gid
    setStackDropTargetId(gid)
  }, [])

  /** Blender-style G/R/S modal transform (null when inactive) */
  const modalXformRef = useRef<ModalTransformSession | null>(null)
  const [modalXformKind, setModalXformKind] = useState<string | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)

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

  const visibleItems = useMemo(
    () => itemsInContainer(items, currentContainerId),
    [items, currentContainerId],
  )
  const visibleStacks = useMemo(
    () => stacks.filter((s) => s.parentId === currentContainerId),
    [stacks, currentContainerId],
  )

  // Drop keep-alive iframes when their embed items are deleted from the board
  useEffect(() => {
    const live = new Set(
      items.filter((i) => i.type === 'embed').map((i) => i.id),
    )
    pruneEmbedIframes(live)
  }, [items])

  // Blender-style G / R / S modal transforms
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      if (!t || !(t instanceof HTMLElement)) return false
      if (t.isContentEditable) return true
      const tag = t.tagName
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (tag === 'INPUT') {
        const type = ((t as HTMLInputElement).type || 'text').toLowerCase()
        return !(
          type === 'color' ||
          type === 'range' ||
          type === 'checkbox' ||
          type === 'radio' ||
          type === 'button' ||
          type === 'submit'
        )
      }
      return false
    }

    const cancelModal = () => {
      const session = modalXformRef.current
      if (!session) return
      useCanvasStore.setState({
        items: session.cancelItems,
        stacks: session.cancelStacks,
      })
      modalXformRef.current = null
      setModalXformKind(null)
      setSnapGuides([])
    }

    const confirmModal = () => {
      if (!modalXformRef.current) return
      modalXformRef.current = null
      setModalXformKind(null)
      setSnapGuides([])
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const store = useCanvasStore.getState()
      if (store.animating) return

      // Active modal: Esc cancels, Enter confirms
      if (modalXformRef.current) {
        if (e.key === 'Escape' || e.code === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          cancelModal()
          return
        }
        if (e.key === 'Enter' || e.code === 'Enter') {
          e.preventDefault()
          confirmModal()
          return
        }
        // Swallow tool keys while modal is active
        return
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== 'g' && key !== 'r' && key !== 's') return
      // Alt+G is unstack — handled elsewhere with altKey
      if (store.selectedIds.length === 0 && store.selectedStackIds.length === 0)
        return

      const kind = key === 'g' ? 'grab' : key === 'r' ? 'rotate' : 'scale'
      const cx = lastPointerRef.current?.x ?? window.innerWidth / 2
      const cy = lastPointerRef.current?.y ?? window.innerHeight / 2
      const session = beginModalTransform(
        kind,
        store.items,
        store.stacks,
        store.selectedIds,
        store.selectedStackIds,
        cx,
        cy,
        store.viewport,
      )
      if (!session) return
      e.preventDefault()
      e.stopPropagation()
      store.pushHistory()
      // Snapshot after history push for RMB cancel
      session.cancelItems = useCanvasStore
        .getState()
        .items.map((i) => ({ ...i }))
      session.cancelStacks = useCanvasStore
        .getState()
        .stacks.map((s) => ({ ...s }))
      modalXformRef.current = session
      setModalXformKind(kind)
    }

    const onPointerMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      const session = modalXformRef.current
      if (!session) return
      const store = useCanvasStore.getState()
      const { itemPatches, stackPatches, guides } = applyModalTransform(
        session,
        e.clientX,
        e.clientY,
        store.viewport,
        {
          snapEnabled: session.kind === 'grab' && store.snapEnabled,
          // R + Shift: 15° angle snap, no reference guides
          angleSnap: session.kind === 'rotate' && e.shiftKey,
          allItems: store.items,
          allStacks: store.stacks,
          containerId: store.currentContainerId,
        },
      )
      if (itemPatches.length) store.updateItems(itemPatches)
      if (stackPatches.length) store.updateStacks(stackPatches)
      // Never show guides for rotate (angle snap is silent)
      setSnapGuides(session.kind === 'rotate' ? [] : guides)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!modalXformRef.current) return
      if (e.button === 0) {
        e.preventDefault()
        e.stopPropagation()
        confirmModal()
      } else if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
        cancelModal()
      }
    }

    const onContextMenu = (e: Event) => {
      if (modalXformRef.current) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [])

  const sortedItems = useMemo(
    () => [...visibleItems].sort((a, b) => a.zIndex - b.zIndex),
    [visibleItems],
  )
  /** Non-embed free items — embeds use a permanent keepalive layer */
  const sortedNonEmbeds = useMemo(
    () => sortedItems.filter((i) => i.type !== 'embed'),
    [sortedItems],
  )
  /** Every board embed, always mounted (pose only changes on stack nav) */
  const allEmbedItems = useMemo(
    () =>
      items
        .filter((i): i is EmbedItem => i.type === 'embed')
        .sort((a, b) => a.zIndex - b.zIndex),
    [items],
  )
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedStackSet = useMemo(
    () => new Set(selectedStackIds),
    [selectedStackIds],
  )
  /** Free selected items on the current canvas (not stacked fan cards) */
  const freeSelectedCount = useMemo(() => {
    return items.filter(
      (i) =>
        selectedIds.includes(i.id) &&
        !i.stacked &&
        containerOf(i) === currentContainerId,
    ).length
  }, [items, selectedIds, currentContainerId])
  const selectedStackCount = useMemo(() => {
    return stacks.filter(
      (s) =>
        selectedStackIds.includes(s.id) && s.parentId === currentContainerId,
    ).length
  }, [stacks, selectedStackIds, currentContainerId])
  const multiBodyCount = freeSelectedCount + selectedStackCount
  const isGroupSelect = multiBodyCount >= 2
  const groupBounds = useMemo(() => {
    if (!isGroupSelect) return null
    return computeSelectionBounds(
      items,
      stacks,
      selectedIds,
      selectedStackIds,
      currentContainerId,
    )
  }, [
    isGroupSelect,
    items,
    stacks,
    selectedIds,
    selectedStackIds,
    currentContainerId,
  ])
  const effectiveTool = spaceHeld ? 'pan' : cHeld ? 'crop' : tool

  // Drive enter-stack folder expand only (exit is store-driven; cards use animateToLayout)
  useEffect(() => {
    if (!stackEnterAnim) return
    if (stackEnterAnim.mode === 'exit') return
    const startSnap = { ...stackEnterAnim.start }
    const stackId = stackEnterAnim.stackId
    const name = stackEnterAnim.name
    const memberCount = stackEnterAnim.memberCount
    const t0 = performance.now()
    // Fast expand; nested B chrome fades in — do NOT move nested leaves (causes jump)
    const morphDur = 380
    // Parent peers: reverse of exit appear (exit: 200ms delay + 500ms ease-in).
    // Enter fades out over 500ms with the same smoothstep so it feels matched.
    const peerFadeDur = 500
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / morphDur)
      const e = 1 - Math.pow(1 - t, 3)
      const nestedChromeOpacity = Math.max(
        0,
        Math.min(1, (e - 0.15) / 0.85),
      )
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
      // Keep ticking until both morph and peer fade finish
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

  const stackFolders = useMemo(() => {
    // Enterable stacks whose parent is the current canvas
    const fromRecords = visibleStacks.map((st) => {
      const members = items.filter((i) => containerOf(i) === st.id)
      // Single bounds logic: direct fan + nested-stack fan (never drop nested content)
      const bounds = collapsedStackFolderBounds(st, items, stacks)
      return {
        gid: st.id,
        members,
        bounds,
        selected: selectedStackSet.has(st.id),
        dropTarget: stackDropTargetId === st.id,
        z: st.zIndex,
        name: st.name,
        record: st as StackRecord,
        proxy: members[0] as CanvasItem | undefined,
        isRecord: true as const,
      }
    })

    // Transient same-canvas fan only (mid Ctrl+G anim / unmigrated legacy).
    // Never treat stackGroupId === currentContainerId as a folder — that was
    // wrapping the entire inner canvas after enter.
    const groups = new Map<string, CanvasItem[]>()
    for (const it of visibleItems) {
      if (!it.stackGroupId || !it.stacked) continue
      if (it.stackGroupId === currentContainerId) continue
      if (fromRecords.some((r) => r.gid === it.stackGroupId)) continue
      // Skip if this group id is already an enterable nested stack record
      if (stacks.some((s) => s.id === it.stackGroupId)) continue
      const list = groups.get(it.stackGroupId) || []
      list.push(it)
      groups.set(it.stackGroupId, list)
    }
    const legacy = [...groups.entries()]
      .map(([gid, members]) => {
        const b = stackGroupBounds(members)
        if (!b) return null
        return {
          gid,
          members,
          bounds: b,
          selected: members.some((m) => selectedSet.has(m.id)),
          dropTarget: stackDropTargetId === gid,
          z: Math.min(...members.map((m) => m.zIndex)) - 1,
          name: members.find((m) => m.stackName)?.stackName || '',
          record: null as StackRecord | null,
          proxy: members[0],
          isRecord: false as const,
        }
      })
      .filter(Boolean) as Array<{
      gid: string
      members: CanvasItem[]
      bounds: { x: number; y: number; width: number; height: number }
      selected: boolean
      dropTarget: boolean
      z: number
      name: string
      record: StackRecord | null
      proxy: CanvasItem
      isRecord: boolean
    }>

    return [...fromRecords, ...legacy]
  }, [
    visibleStacks,
    visibleItems,
    items,
    stacks,
    currentContainerId,
    selectedSet,
    selectedStackSet,
    stackDropTargetId,
  ])

  /**
   * Fan cards for collapsed stacks — MUST use the same set as folder bounds
   * (collapsedStackFanCards) so chrome never shrinks past nested content.
   */
  const stackPreviewItems = useMemo(() => {
    const out: CanvasItem[] = []
    for (const st of visibleStacks) {
      for (const c of collapsedStackFanCards(st, items, stacks)) {
        const m = items.find((i) => i.id === c.id)
        if (!m || m.type === 'embed') continue
        out.push({
          ...m,
          x: c.x,
          y: c.y,
          rotation: c.rotation,
          stacked: true,
          stackGroupId: st.id,
        })
      }
    }
    return out.sort((a, b) => a.zIndex - b.zIndex)
  }, [visibleStacks, items, stacks])

  const getLocalPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    }
  }, [])

  /** One store write per frame while dragging — cuts jank from multi-event frames */
  const scheduleDragWrite = useCallback((fn: () => void) => {
    pendingDragWriteRef.current = fn
    if (dragRafRef.current) return
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = 0
      const run = pendingDragWriteRef.current
      pendingDragWriteRef.current = null
      run?.()
    })
  }, [])

  const flushDragWrite = useCallback(() => {
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = 0
    }
    const run = pendingDragWriteRef.current
    pendingDragWriteRef.current = null
    run?.()
  }, [])

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const store = useCanvasStore.getState()
      const rect = el.getBoundingClientRect()
      const local = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const looksLikeTrackpad = Math.abs(e.deltaX) > 0.5 && Math.abs(e.deltaY) > 0.5

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

  const blurChrome = () => {
    const ae = document.activeElement as HTMLElement | null
    if (
      ae &&
      ae !== document.body &&
      (ae.tagName === 'INPUT' ||
        ae.tagName === 'SELECT' ||
        ae.tagName === 'BUTTON' ||
        ae.tagName === 'TEXTAREA')
    ) {
      // Don't blur textarea while editing text on canvas
      if (ae.tagName === 'TEXTAREA' && ae.closest('.canvas-item')) return
      ae.blur()
    }
  }

  /**
   * True while stack enter/exit, layout fan, or any store-driven pose anim runs.
   * Interaction must not start during this — aborting anims mid-flight freezes
   * items at intermediate poses (the old cancelLayoutAnimation bug).
   */
  const isInteractionLocked = () => {
    const s = useCanvasStore.getState()
    return !!(s.animating || s.stackEnterAnim)
  }

  const dismissStackNameEdit = () => {
    const store = useCanvasStore.getState()
    if (!store.editingStackGroupId) return
    const ae = document.activeElement as HTMLInputElement | null
    if (ae?.classList?.contains('stack-folder-name-input')) {
      store.commitStackName(store.editingStackGroupId, ae.value)
    } else {
      useCanvasStore.setState({ editingStackGroupId: null })
    }
  }

  /**
   * Resize starts ONLY from handle onPointerDown (CanvasItemView).
   * Isolated from move path so handle clicks never become a pan/move.
   */
  const onGroupScalePointerDown = useCallback(
    (e: React.PointerEvent, handle: GroupScaleHandle) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      const store = useCanvasStore.getState()
      if (isInteractionLocked()) return
      if (store.spaceHeld || store.tool === 'pan') return
      const bounds = computeSelectionBounds(
        store.items,
        store.stacks,
        store.selectedIds,
        store.selectedStackIds,
        store.currentContainerId,
      )
      if (!bounds) return
      const bodies: GroupBodyOrigin[] = []
      for (const id of store.selectedIds) {
        const it = store.items.find((i) => i.id === id)
        if (!it || it.stacked) continue
        if (containerOf(it) !== store.currentContainerId) continue
        bodies.push({
          id: it.id,
          kind: 'item',
          x: it.x,
          y: it.y,
          width: it.width,
          height: it.height,
          rotation: it.rotation ?? 0,
          scalable: isGroupScalableType(it.type),
        })
      }
      for (const sid of store.selectedStackIds) {
        const st = store.stacks.find((s) => s.id === sid)
        if (!st || st.parentId !== store.currentContainerId) continue
        const leaves = collectItemsInStackTree(store.items, store.stacks, sid)
        const b = stackCollapsedSnapBounds(st, leaves)
        bodies.push({
          id: sid,
          kind: 'stack',
          x: st.x,
          y: st.y,
          width: b.width,
          height: b.height,
          scalable: false,
        })
      }
      if (bodies.length < 2) return
      dismissStackNameEdit()
      blurChrome()
      flushDragWrite()
      store.pushHistory()
      dragRef.current = {
        kind: 'group-scale',
        handle,
        bounds,
        bodies,
      }
      surfaceRef.current?.setPointerCapture(e.pointerId)
    },
    [flushDragWrite],
  )

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent, item: CanvasItem, handle: string) => {
      if (e.button !== 0) return
      const store = useCanvasStore.getState()
      if (item.stacked && item.stackGroupId) return
      // Block resize while stack/layout animations run
      if (isInteractionLocked()) return
      // Multi-select uses group bbox handles instead of per-item resize
      const multi =
        store.selectedIds.filter((id) => {
          const it = store.items.find((i) => i.id === id)
          return it && !it.stacked && containerOf(it) === store.currentContainerId
        }).length +
          store.selectedStackIds.filter((sid) =>
            store.stacks.some(
              (s) => s.id === sid && s.parentId === store.currentContainerId,
            ),
          ).length >=
        2
      if (multi) return

      dismissStackNameEdit()
      blurChrome()
      flushDragWrite()

      if (store.spaceHeld || store.tool === 'pan') return
      if (store.tool === 'scribble' || store.tool === 'erase') return

      const live = store.items.find((i) => i.id === item.id) ?? item
      // Scribble / embed: no resize handles (notes & links keep edge/corner resize)
      if (live.type === 'scribble' || live.type === 'embed') return
      const h = (handle || 'se').toLowerCase()
      const edgeMode: 'scale' | 'edge' = isEdgeResizeType(live.type)
        ? 'edge'
        : 'scale'
      const isMediaItem =
        live.type === 'image' || live.type === 'gif' || live.type === 'video'
      const isText = live.type === 'text'

      if (!store.selectedIds.includes(live.id)) {
        store.select([live.id])
      }
      store.pushHistory()
      clearTextScalePreview()

      dragRef.current = {
        kind: 'resize',
        id: live.id,
        handle: h,
        startX: e.clientX,
        startY: e.clientY,
        orig: {
          x: live.x,
          y: live.y,
          width: live.width,
          height: live.height,
        },
        edgeMode,
        isMedia: isMediaItem,
        isText,
        origFontSize: isText && live.type === 'text' ? live.fontSize : undefined,
      }

      surfaceRef.current?.setPointerCapture(e.pointerId)
    },
    [flushDragWrite],
  )

  /** Enter note/text edit without select() wiping editingId */
  const enterTextEdit = (itemId: string) => {
    const store = useCanvasStore.getState()
    if (!store.selectedIds.includes(itemId)) {
      store.select([itemId])
    }
    // select() clears editingId — set edit after
    useCanvasStore.setState({ editingId: itemId, editingStackGroupId: null })
  }


  const onItemPointerDown = useCallback(
    (e: React.PointerEvent, item: CanvasItem) => {
      if (e.button !== 0) return
      // Handles have their own handler with stopPropagation — if we get here,
      // this is a body click (move), not a resize handle.
      if ((e.target as HTMLElement).closest?.('[data-handle]')) return

      const store = useCanvasStore.getState()

      // Stack enter/exit & layout anims: ignore clicks so we never freeze mid-pose
      if (isInteractionLocked()) {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      dismissStackNameEdit()
      blurChrome()
      flushDragWrite()

      if (store.spaceHeld || store.tool === 'pan') return
      if (store.tool === 'scribble' || store.tool === 'erase') return

      const isStacked = !!(item.stacked && item.stackGroupId)
      const canEditText =
        !isStacked && (item.type === 'text' || item.type === 'textcard')

      // Crop mode (hold C)
      if (store.cHeld) {
        e.stopPropagation()
        e.preventDefault()
        const local = getLocalPoint(e)
        const world = screenToWorld(local.x, local.y, store.viewport)
        const { ids, rotatedOnly } = resolveCropTargets(
          world,
          store.items,
          store.selectedIds,
          store.selectedStackIds,
          store.currentContainerId,
        )
        if (ids.length === 0) {
          if (rotatedOnly) store.flashSaveNotice(CROP_ROTATED_HINT)
          return
        }
        // Keep multi-selection; add crop targets if missing (no toggle)
        const needSelect = ids.filter((id) => !store.selectedIds.includes(id))
        if (needSelect.length > 0) {
          store.select([...store.selectedIds, ...needSelect])
        }
        dragRef.current = {
          kind: 'crop',
          ids,
          startWorld: { ...world },
          currentWorld: { ...world },
        }
        surfaceRef.current?.setPointerCapture(e.pointerId)
        setCropOverlay({ x: local.x, y: local.y, w: 0, h: 0 })
        return
      }

      e.stopPropagation()

      // Double-click (detail>=2): text edit, open link, or enter stack
      if (e.detail >= 2) {
        if (canEditText) {
          enterTextEdit(item.id)
          return
        }
        if (item.type === 'link' && !isStacked) {
          const url = (item as { url?: string }).url?.trim()
          if (url) {
            e.preventDefault()
            void openExternal(url)
          }
          return
        }
        if (isStacked && item.stackGroupId) {
          // Enter nested canvas; rename only via folder tab double-click
          const st = useCanvasStore.getState()
          const folder = st.stacks.find((s) => s.id === item.stackGroupId)
          if (folder) {
            const vp = st.viewport
            st.enterStack(item.stackGroupId, {
              // Surface-local coords (overlay is absolute inside canvas-surface)
              x: folder.x * vp.zoom + vp.x,
              y: folder.y * vp.zoom + vp.y,
              w: folder.width * vp.zoom,
              h: folder.height * vp.zoom,
            })
          } else {
            // Legacy stack: migrate-on-the-fly by entering via group id after migrate
            st.enterStack(item.stackGroupId)
          }
          return
        }
      }

      // Drag started on embed drag-bar only when embed is live — body clicks
      // are stopped inside EmbedItemView. Skip canvas drag if target is iframe.
      if (
        item.type === 'embed' &&
        (e.target as HTMLElement).closest?.('iframe, .embed-frame')
      ) {
        // Only allow move from the dedicated drag bar
        if (!(e.target as HTMLElement).closest?.('[data-embed-drag]')) {
          // If cold (shield), fall through to normal select/drag
          if ((e.target as HTMLElement).closest?.('.embed-item.is-live')) {
            return
          }
        }
      }

      // While editing this item, clicks stay for text selection
      if (canEditText && store.editingId === item.id) {
        return
      }

      const additive = e.shiftKey || e.ctrlKey || e.metaKey
      let ids = store.selectedIds
      if (additive) {
        store.select([item.id], true)
        ids = useCanvasStore.getState().selectedIds
      } else if (!store.selectedIds.includes(item.id)) {
        const expanded = expandStackSelection([item.id], store.items)
        store.select(expanded)
        ids = expanded
      } else {
        // Already selected: keep selection. Do NOT clear editing here on
        // first half of a double-click — that raced with enter-edit.
        ids = expandStackSelection(store.selectedIds, store.items)
        if (ids.length !== store.selectedIds.length) store.select(ids)
      }

      // Joint move: free items + selected stacks together
      const joint = captureJointMoveSelection(useCanvasStore.getState())
      // Ensure the clicked free item is included
      if (!joint.ids.includes(item.id) && !isStacked) {
        joint.ids = [...joint.ids, item.id]
        const it = useCanvasStore.getState().items.find((i) => i.id === item.id)
        if (it) joint.origins[item.id] = { x: it.x, y: it.y }
      }
      if (joint.ids.length === 0 && joint.stackIds.length === 0) return

      // Pending until movement exceeds threshold — preserves double-click edit
      const canOpenLink = !isStacked && item.type === 'link'
      const linkUrl =
        canOpenLink && item.type === 'link' ? item.url?.trim() || '' : undefined
      dragRef.current = {
        kind: 'pending-move',
        itemId: item.id,
        isStacked,
        stackGroupId: item.stackGroupId,
        canEditText,
        canOpenLink,
        linkUrl,
        startClientX: e.clientX,
        startClientY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        ids: joint.ids,
        origins: joint.origins,
        stackIds: joint.stackIds,
        stackOrigins: joint.stackOrigins,
        duplicated: false,
        altHeld: e.altKey,
      }

      surfaceRef.current?.setPointerCapture(e.pointerId)
    },
    [flushDragWrite, getLocalPoint],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      blurChrome()

      // Middle-click pans canvas; right-click is reserved for window drag (Electron)
      if (e.button === 1) {
        e.preventDefault()
        useCanvasStore.getState().setIsPanning(true)
        dragRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY }
        surfaceRef.current?.setPointerCapture(e.pointerId)
        return
      }
      if (e.button === 2) {
        // Let useWindowDrag handle right-button window move
        return
      }
      if (e.button !== 0) return

      const store = useCanvasStore.getState()
      const local = getLocalPoint(e)
      const world = screenToWorld(local.x, local.y, store.viewport)
      // Always read live store flags (avoid stale React closure)
      const holdingC = store.cHeld
      const holdingSpace = store.spaceHeld

      // Pan always allowed (including during stack anim)
      if (holdingSpace || store.tool === 'pan') {
        store.setIsPanning(true)
        dragRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY }
        surfaceRef.current?.setPointerCapture(e.pointerId)
        return
      }

      // During stack/layout anims: block marquee, draw, create, crop
      if (isInteractionLocked()) return

      // PureRef-style crop: hold C + drag anywhere (uses selected media if start is outside)
      if (holdingC) {
        const { ids, rotatedOnly } = resolveCropTargets(
          world,
          store.items,
          store.selectedIds,
          store.selectedStackIds,
          store.currentContainerId,
        )
        if (ids.length > 0) {
          // Preserve selection — never clear while cropping
          const needSelect = ids.filter((id) => !store.selectedIds.includes(id))
          if (needSelect.length > 0) {
            store.select([...store.selectedIds, ...needSelect])
          }
          dragRef.current = {
            kind: 'crop',
            ids,
            startWorld: { ...world },
            currentWorld: { ...world },
          }
          setCropOverlay({ x: local.x, y: local.y, w: 0, h: 0 })
          surfaceRef.current?.setPointerCapture(e.pointerId)
          return
        }
        if (rotatedOnly) {
          store.flashSaveNotice(CROP_ROTATED_HINT)
        }
        // Holding C with no crop target: do nothing (do not marquee / deselect)
        return
      }

      if (store.tool === 'text') {
        store.addText(world)
        return
      }

      // Note tool: drag a rect to size; click → default size
      if (store.tool === 'textcard') {
        dragRef.current = {
          kind: 'create-note',
          startWorld: { ...world },
          startLocal: { ...local },
          x: local.x,
          y: local.y,
          w: 0,
          h: 0,
        }
        setMarquee({ x: local.x, y: local.y, w: 0, h: 0 })
        surfaceRef.current?.setPointerCapture(e.pointerId)
        return
      }

      if (store.tool === 'link') {
        store.addLinkCard(world)
        return
      }

      if (store.tool === 'scribble') {
        const id = store.startScribble(world)
        dragRef.current = { kind: 'scribble', id }
        surfaceRef.current?.setPointerCapture(e.pointerId)
        return
      }

      if (store.tool === 'erase') {
        eraseHistoryPushed.current = false
        store.pushHistory()
        eraseHistoryPushed.current = true
        store.eraseAt(world)
        dragRef.current = { kind: 'erase', erased: true }
        surfaceRef.current?.setPointerCapture(e.pointerId)
        return
      }

      dragRef.current = {
        kind: 'marquee',
        startX: local.x,
        startY: local.y,
        x: local.x,
        y: local.y,
        w: 0,
        h: 0,
        additive: e.shiftKey || e.ctrlKey || e.metaKey,
      }
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) store.clearSelection()
      setMarquee({ x: local.x, y: local.y, w: 0, h: 0 })
      surfaceRef.current?.setPointerCapture(e.pointerId)
    },
    [getLocalPoint, spaceHeld, cHeld],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const store = useCanvasStore.getState()

      if (drag.kind === 'pan') {
        store.panBy(e.clientX - drag.lastX, e.clientY - drag.lastY)
        drag.lastX = e.clientX
        drag.lastY = e.clientY
        return
      }

      // Promote click → drag after threshold (keeps double-click available)
      if (drag.kind === 'pending-move') {
        const dist = Math.hypot(
          e.clientX - drag.startClientX,
          e.clientY - drag.startClientY,
        )
        if (dist < DRAG_THRESHOLD_PX) {
          drag.lastX = e.clientX
          drag.lastY = e.clientY
          return
        }
        // Real drag: push history once, then duplicate only after the pointer
        // has crossed the drag threshold. Alt-click remains a normal click.
        store.pushHistory()
        let moveIds = drag.ids
        let origins = drag.origins
        let stackIds = drag.stackIds
        let stackOrigins = drag.stackOrigins
        let duplicated = false
        if (e.altKey) {
          const dup = store.duplicateBodies(moveIds, stackIds ?? [])
          moveIds = dup.itemIds
          stackIds = dup.stackIds
          const live = useCanvasStore.getState()
          origins = {}
          for (const id of moveIds) {
            const item = live.items.find((candidate) => candidate.id === id)
            if (item) origins[id] = { x: item.x, y: item.y }
          }
          stackOrigins = {}
          for (const sid of stackIds) {
            const st = live.stacks.find((s) => s.id === sid)
            if (st) stackOrigins[sid] = { x: st.x, y: st.y }
          }
          duplicated = true
        }
        // Leave text edit if any
        if (store.editingId) {
          useCanvasStore.setState({ editingId: null })
        }
        dragRef.current = {
          kind: 'move',
          ids: moveIds,
          stackIds,
          stackOrigins,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
          duplicated,
          altHeld: e.altKey,
          origins,
          accDx: 0,
          accDy: 0,
        }
        lastItemClickRef.current = null
        // fall through into move handling with zero delta this frame
        return
      }

      if (drag.kind === 'move') {
        if (e.altKey && !drag.duplicated && !drag.moved) {
          const dup = store.duplicateBodies(drag.ids, drag.stackIds ?? [])
          drag.ids = dup.itemIds
          drag.stackIds = dup.stackIds
          drag.duplicated = true
          drag.altHeld = true
          const live = useCanvasStore.getState()
          drag.origins = {}
          for (const id of dup.itemIds) {
            const it = live.items.find((i) => i.id === id)
            if (it) drag.origins[id] = { x: it.x, y: it.y }
          }
          drag.stackOrigins = {}
          for (const sid of dup.stackIds) {
            const st = live.stacks.find((s) => s.id === sid)
            if (st) drag.stackOrigins![sid] = { x: st.x, y: st.y }
          }
          drag.accDx = 0
          drag.accDy = 0
        }
        const zoom = Math.max(0.01, store.viewport.zoom || 1)
        const dx = (e.clientX - drag.lastX) / zoom
        const dy = (e.clientY - drag.lastY) / zoom
        drag.lastX = e.clientX
        drag.lastY = e.clientY
        if (dx === 0 && dy === 0) return

        drag.accDx += dx
        drag.accDy += dy
        drag.moved = true

        // Snapshot for rAF write (refs must not be read late with stale values)
        const ids = drag.ids
        const origins = drag.origins
        const accDx = drag.accDx
        const accDy = drag.accDy
        const snapOn = store.snapEnabled
        const pointerLocal = getLocalPoint(e)

        const stackIds = drag.stackIds ?? []
        const stackOrigins = drag.stackOrigins ?? {}

        scheduleDragWrite(() => {
          const st = useCanvasStore.getState()
          const freeTargets = ids.map((id) => {
            const o = origins[id]
            const it = st.items.find((i) => i.id === id)
            return {
              id,
              x: (o?.x ?? it?.x ?? 0) + accDx,
              y: (o?.y ?? it?.y ?? 0) + accDy,
              width: it?.width ?? 0,
              height: it?.height ?? 0,
              type: it?.type ?? 'text',
              rotation: it?.rotation ?? 0,
              zIndex: it?.zIndex ?? 0,
              stacked: it?.stacked,
              stackGroupId: it?.stackGroupId,
            } as CanvasItem
          })

          let finalDx = accDx
          let finalDy = accDy
          let guides: SnapGuide[] = []
          if (snapOn && (freeTargets.length > 0 || stackIds.length > 0)) {
            const threshold = 10 / Math.max(0.01, st.viewport.zoom || 1)
            const movingStacks = stackIds.map((id) => {
              const o = stackOrigins[id]
              const sk = st.stacks.find((s) => s.id === id)
              return {
                x: (o?.x ?? sk?.x ?? 0) + accDx,
                y: (o?.y ?? sk?.y ?? 0) + accDy,
                width: sk?.width ?? 100,
                height: sk?.height ?? 100,
                name: sk?.name,
              }
            })
            const snap = computeSnapDelta(freeTargets, st.items, threshold, {
              stacks: st.stacks,
              containerId: st.currentContainerId,
              excludeStackIds: stackIds,
              movingStacks,
            })
            finalDx += snap.dx
            finalDy += snap.dy
            guides = snap.guides
          }

          if (ids.length) {
            st.updateItems(
              ids.map((id) => {
                const o = origins[id]
                return {
                  id,
                  patch: {
                    x: (o?.x ?? 0) + finalDx,
                    y: (o?.y ?? 0) + finalDy,
                  },
                }
              }),
            )
          }
          if (stackIds.length) {
            st.updateStacks(
              stackIds.map((id) => {
                const o = stackOrigins[id]
                return {
                  id,
                  patch: {
                    x: (o?.x ?? 0) + finalDx,
                    y: (o?.y ?? 0) + finalDy,
                  },
                }
              }),
            )
          }
          setSnapGuides((prev) => (guidesEqual(prev, guides) ? prev : guides))

          // Merge highlight: free materials over a stack folder
          const live = useCanvasStore.getState()
          const draggingStacked =
            stackIds.length > 0 ||
            ids.some((id) => {
              const it = live.items.find((i) => i.id === id)
              return !!(it?.stacked && it.stackGroupId)
            })
          if (draggingStacked) {
            setStackDropTarget(null)
          } else {
            const world = screenToWorld(
              pointerLocal.x,
              pointerLocal.y,
              st.viewport,
            )
            const hit = hitStackGroupAt(world, live.items, {
              excludeIds: ids,
              stacks: live.stacks.filter(
                (s) => s.parentId === live.currentContainerId,
              ),
            })
            setStackDropTarget(hit)
          }
        })
        return
      }

      if (drag.kind === 'resize') {
        const zoom = Math.max(0.01, store.viewport.zoom || 1)
        const dx = (e.clientX - drag.startX) / zoom
        const dy = (e.clientY - drag.startY) / zoom
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return

        const isCorner = drag.handle.length === 2
        const shift = e.shiftKey

        let keepAspect = false
        let resizeMode: 'scale' | 'edge' = drag.edgeMode
        let textLiveScale = false

        if (drag.isText && isCorner) {
          if (shift) {
            keepAspect = true
            resizeMode = 'scale'
            textLiveScale = true
          } else {
            keepAspect = false
            resizeMode = 'scale'
            textLiveScale = false
            drag.textScaleActive = false
            clearTextScalePreview()
          }
        } else if (drag.isMedia) {
          keepAspect = !isCorner || !shift
          resizeMode = 'scale'
          drag.textScaleActive = false
          clearTextScalePreview()
        } else {
          keepAspect = false
          resizeMode = drag.edgeMode
          drag.textScaleActive = false
          clearTextScalePreview()
        }

        let next = computeResize(
          drag.handle,
          drag.orig,
          dx,
          dy,
          keepAspect,
          resizeMode,
        )
        if (
          !next ||
          !Number.isFinite(next.width) ||
          !Number.isFinite(next.height)
        ) {
          return
        }

        const aspect = drag.orig.width / Math.max(1e-6, drag.orig.height)
        let guides: SnapGuide[] = []
        if (store.snapEnabled) {
          // ~12 screen px snap distance (world units)
          const threshold = 12 / zoom
          const snapped = snapResizeRect(
            next,
            drag.handle,
            drag.id,
            store.items,
            threshold,
            keepAspect ? aspect : undefined,
            {
              stacks: store.stacks,
              containerId: store.currentContainerId,
            },
          )
          next = snapped.rect
          guides = snapped.guides
        }

        const w = Math.max(24, next.width)
        const h = Math.max(24, next.height)
        const nx = next.x
        const ny = next.y
        const id = drag.id

        if (textLiveScale && drag.origFontSize && drag.orig.width > 1) {
          // CSS transform preview path (no per-frame font write)
          const scale = Math.max(0.05, w / drag.orig.width)
          drag.lastTextScale = scale
          drag.textScaleActive = true
          setTextScalePreview({
            id: drag.id,
            scale,
            origin: originFromHandle(drag.handle),
            baseX: nx,
            baseY: ny,
            baseW: w,
            baseH: h,
            baseFont: drag.origFontSize,
          })
          setSnapGuides((prev) => (guidesEqual(prev, guides) ? prev : guides))
          return
        }

        // Apply immediately so geometry matches guides (rAF made snap feel missing)
        store.resizeItem(id, w, h, nx, ny)
        setSnapGuides((prev) => (guidesEqual(prev, guides) ? prev : guides))
        return
      }

      if (drag.kind === 'scribble') {
        const local = getLocalPoint(e)
        const world = screenToWorld(local.x, local.y, store.viewport)
        store.appendScribblePoint(drag.id, world)
        return
      }

      if (drag.kind === 'erase') {
        const local = getLocalPoint(e)
        const world = screenToWorld(local.x, local.y, store.viewport)
        store.eraseAt(world)
        return
      }

      if (drag.kind === 'crop') {
        const local = getLocalPoint(e)
        const world = screenToWorld(local.x, local.y, store.viewport)
        drag.currentWorld = world
        const x1 = Math.min(drag.startWorld.x, world.x)
        const y1 = Math.min(drag.startWorld.y, world.y)
        const x2 = Math.max(drag.startWorld.x, world.x)
        const y2 = Math.max(drag.startWorld.y, world.y)
        // Convert world rect corners to screen for overlay
        const s1 = {
          x: x1 * store.viewport.zoom + store.viewport.x,
          y: y1 * store.viewport.zoom + store.viewport.y,
        }
        const s2 = {
          x: x2 * store.viewport.zoom + store.viewport.x,
          y: y2 * store.viewport.zoom + store.viewport.y,
        }
        setCropOverlay({
          x: s1.x,
          y: s1.y,
          w: s2.x - s1.x,
          h: s2.y - s1.y,
        })
        return
      }

      if (drag.kind === 'group-scale') {
        const local = getLocalPoint(e)
        const world = screenToWorld(local.x, local.y, store.viewport)
        const zoom = Math.max(0.01, store.viewport.zoom || 1)
        let factor = groupScaleFactor(
          drag.bounds,
          drag.handle,
          world.x,
          world.y,
        )
        // Propose scaled group box, then snap free edges like single-media resize
        let guides: SnapGuide[] = []
        if (store.snapEnabled) {
          const proposed = groupScaledBounds(
            drag.bounds,
            drag.handle,
            factor,
          )
          const aspect = drag.bounds.width / Math.max(1e-6, drag.bounds.height)
          const excludeIds = [
            ...drag.bodies.map((b) => b.id),
            // stack folder ids already in bodies; leaves excluded via stackGroup if any
          ]
          const threshold = 12 / zoom
          const snapped = snapResizeRect(
            proposed,
            drag.handle,
            excludeIds,
            store.items,
            threshold,
            aspect,
            {
              stacks: store.stacks,
              containerId: store.currentContainerId,
              excludeStackIds: drag.bodies
                .filter((b) => b.kind === 'stack')
                .map((b) => b.id),
            },
          )
          guides = snapped.guides
          factor = groupFactorFromSnappedBox(
            drag.bounds,
            snapped.rect,
            drag.handle,
          )
        }
        const results = applyGroupScale(
          drag.bodies,
          drag.bounds,
          drag.handle,
          factor,
        )
        const itemPatches: Array<{
          id: string
          patch: Partial<CanvasItem>
        }> = []
        const stackPatches: Array<{
          id: string
          patch: Partial<import('../types/canvas').StackRecord>
        }> = []
        for (const r of results) {
          if (r.kind === 'item') {
            itemPatches.push({
              id: r.id,
              patch: {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
              },
            })
          } else {
            stackPatches.push({
              id: r.id,
              patch: { x: r.x, y: r.y },
            })
          }
        }
        if (itemPatches.length) store.updateItems(itemPatches)
        if (stackPatches.length) store.updateStacks(stackPatches)
        setSnapGuides((prev) => (guidesEqual(prev, guides) ? prev : guides))
        return
      }

      if (drag.kind === 'marquee') {
        const local = getLocalPoint(e)
        const x = Math.min(drag.startX, local.x)
        const y = Math.min(drag.startY, local.y)
        const w = Math.abs(local.x - drag.startX)
        const h = Math.abs(local.y - drag.startY)
        drag.x = x
        drag.y = y
        drag.w = w
        drag.h = h
        setMarquee({ x, y, w, h })
      }

      if (drag.kind === 'create-note') {
        const local = getLocalPoint(e)
        const x = Math.min(drag.startLocal.x, local.x)
        const y = Math.min(drag.startLocal.y, local.y)
        const w = Math.abs(local.x - drag.startLocal.x)
        const h = Math.abs(local.y - drag.startLocal.y)
        drag.x = x
        drag.y = y
        drag.w = w
        drag.h = h
        setMarquee({ x, y, w, h })
      }
    },
    [getLocalPoint, scheduleDragWrite, setStackDropTarget],
  )

  const onPointerUp = useCallback(() => {
    // Apply any coalesced drag write before ending
    flushDragWrite()

    const drag = dragRef.current
    const store = useCanvasStore.getState()

    // Pure click (no drag past threshold): detect double-click → edit
    if (drag?.kind === 'pending-move') {
      const now = performance.now()
      const distFromStart = Math.hypot(
        drag.lastX - drag.startClientX,
        drag.lastY - drag.startClientY,
      )
      const stillClick = distFromStart < DRAG_THRESHOLD_PX

      if (stillClick) {
        const prev = lastItemClickRef.current
        const isDbl =
          !!prev &&
          prev.id === drag.itemId &&
          now - prev.t < 450 &&
          Math.hypot(drag.lastX - prev.x, drag.lastY - prev.y) < 12

        if (isDbl) {
          if (drag.canEditText) {
            enterTextEdit(drag.itemId)
          } else if (drag.canOpenLink && drag.linkUrl) {
            // pointer-capture often suppresses native dblclick — open here
            void openExternal(drag.linkUrl)
          } else if (drag.isStacked && drag.stackGroupId) {
            const st = useCanvasStore.getState()
            const folder = st.stacks.find((s) => s.id === drag.stackGroupId)
            if (folder) {
              const vp = st.viewport
              st.enterStack(drag.stackGroupId, {
                x: folder.x * vp.zoom + vp.x,
                y: folder.y * vp.zoom + vp.y,
                w: folder.width * vp.zoom,
                h: folder.height * vp.zoom,
              })
            }
          }
          lastItemClickRef.current = null
        } else {
          lastItemClickRef.current = {
            id: drag.itemId,
            t: now,
            x: drag.lastX,
            y: drag.lastY,
          }
        }
      } else {
        lastItemClickRef.current = null
      }

      dragRef.current = null
      eraseHistoryPushed.current = false
      return
    }

    if (drag?.kind === 'group-scale') {
      dragRef.current = null
      setSnapGuides([])
      eraseHistoryPushed.current = false
      return
    }

    // Resize: commit text CSS-scale preview if used
    if (drag?.kind === 'resize') {
      if (drag.isText && drag.origFontSize && drag.orig.width > 1) {
        const p = getTextScalePreview()
        const scale =
          p && p.id === drag.id
            ? p.scale
            : drag.textScaleActive && drag.lastTextScale
              ? drag.lastTextScale
              : null
        if (scale != null && Math.abs(scale - 1) > 0.001) {
          const box = scaledBoxFromPreview({
            id: drag.id,
            scale,
            origin: originFromHandle(drag.handle),
            baseX: drag.orig.x,
            baseY: drag.orig.y,
            baseW: drag.orig.width,
            baseH: drag.orig.height,
            baseFont: drag.origFontSize,
          })
          store.updateItem(drag.id, {
            x: box.x,
            y: box.y,
            width: Math.max(24, box.width),
            height: Math.max(24, box.height),
            fontSize: Math.max(8, Math.min(200, Math.round(box.fontSize))),
          })
        }
      }
      clearTextScalePreview()
      dragRef.current = null
      setSnapGuides([])
      eraseHistoryPushed.current = false
      return
    }

    if (drag?.kind === 'pan') {
      store.setIsPanning(false)
    }

    if (drag?.kind === 'move') {
      setSnapGuides([])
      const dropGid = stackDropTargetRef.current
      setStackDropTarget(null)
      if (dropGid && drag.moved) {
        const freeIds = drag.ids.filter((id) => {
          const it = store.items.find((i) => i.id === id)
          return !!it && !it.stacked
        })
        if (freeIds.length > 0) {
          store.mergeIntoStack(freeIds, dropGid)
        }
      }
    }

    if (drag?.kind === 'scribble') {
      store.endScribble()
    }

    if (drag?.kind === 'crop') {
      const x = Math.min(drag.startWorld.x, drag.currentWorld.x)
      const y = Math.min(drag.startWorld.y, drag.currentWorld.y)
      const width = Math.abs(drag.currentWorld.x - drag.startWorld.x)
      const height = Math.abs(drag.currentWorld.y - drag.startWorld.y)
      if (width > 8 && height > 8 && drag.ids.length > 0) {
        store.applyCrop(drag.ids, { x, y, width, height })
      }
      setCropOverlay(null)
    }

    if (drag?.kind === 'marquee') {
      const { x, y, w, h, additive } = drag
      if (w > 3 || h > 3) {
        const vp = store.viewport
        const worldRect = {
          x: (x - vp.x) / vp.zoom,
          y: (y - vp.y) / vp.zoom,
          w: w / vp.zoom,
          h: h / vp.zoom,
        }
        const marqueeBox = {
          x: worldRect.x,
          y: worldRect.y,
          width: worldRect.w,
          height: worldRect.h,
        }
        // Free items only on this canvas — rotation-aware visual hit
        const hit = store.items
          .filter(
            (item) =>
              containerOf(item) === store.currentContainerId && !item.stacked,
          )
          .filter((item) => marqueeHitsRotatedItem(marqueeBox, item))
          .map((i) => i.id)

        const hitStacks = store.stacks
          .filter((s) => s.parentId === store.currentContainerId)
          .filter((s) => {
            const leaves = collectItemsInStackTree(
              store.items,
              store.stacks,
              s.id,
            )
            // Use folder+fan visual hull (same as snap/align)
            const b = stackCollapsedSnapBounds(s, leaves)
            return (
              b.x < marqueeBox.x + marqueeBox.width &&
              b.x + b.width > marqueeBox.x &&
              b.y < marqueeBox.y + marqueeBox.height &&
              b.y + b.height > marqueeBox.y
            )
          })
          .map((s) => s.id)

        const nextIds = additive
          ? [...new Set([...store.selectedIds, ...hit])]
          : hit
        const nextStacks = additive
          ? [...new Set([...store.selectedStackIds, ...hitStacks])]
          : hitStacks
        // Raise free items + nested stacks as one selection
        if (nextStacks.length > 0) {
          store.selectBodies(nextIds, nextStacks)
        } else {
          store.select(nextIds)
        }
      }
      setMarquee(null)
    }

    if (drag?.kind === 'create-note') {
      const vp = store.viewport
      const zoom = vp.zoom || 1
      // Click (tiny drag) → default note; drag → rect size in world units
      if (drag.w < 8 && drag.h < 8) {
        store.addTextCard(drag.startWorld)
      } else {
        const wx = (drag.x - vp.x) / zoom
        const wy = (drag.y - vp.y) / zoom
        const ww = Math.max(120, drag.w / zoom)
        const wh = Math.max(80, drag.h / zoom)
        store.addTextCard({ x: wx, y: wy }, { width: ww, height: wh })
      }
      setMarquee(null)
    }

    dragRef.current = null
    eraseHistoryPushed.current = false
    setStackDropTarget(null)
  }, [flushDragWrite, setStackDropTarget])

  const placeMediaAt = useCallback(
    async (
      worldX: number,
      worldY: number,
      sources: Array<{ kind: 'file'; file: File } | { kind: 'path'; path: string }>,
    ) => {
      if (!sources.length) return
      const store = useCanvasStore.getState()
      const raw = []
      let z = store.nextZ
      for (const src of sources) {
        const item =
          src.kind === 'file'
            ? await createMediaFromFile(src.file, worldX, worldY, z++)
            : await createMediaFromPath(src.path, worldX, worldY, z++)
        if (item) raw.push(item)
      }
      if (raw.length) {
        store.addItems(placeItemsTight(raw, worldX, worldY, 4))
      }
    },
    [],
  )

  // Optional native path listener (no-op when dragDropEnabled:false — HTML5 handles all).
  // Kept as a safety net if a platform still emits Tauri drag events.
  useEffect(() => {
    if (!isDesktop()) return
    let disposed = false
    let unlisten: (() => void) | undefined

    void onNativeFileDrop((ev) => {
      if (disposed) return
      if (ev.type === 'enter' || ev.type === 'over') {
        setDropActive(true)
        return
      }
      if (ev.type === 'leave') {
        setDropActive(false)
        return
      }
      setDropActive(false)
      if (!ev.paths.length) return
      const store = useCanvasStore.getState()
      const rect = surfaceRef.current?.getBoundingClientRect()
      const localX = ev.x - (rect?.left ?? 0)
      const localY = ev.y - (rect?.top ?? 0)
      const world = screenToWorld(localX, localY, store.viewport)
      void placeMediaAt(
        world.x,
        world.y,
        ev.paths.map((path) => ({ kind: 'path' as const, path })),
      )
    }).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [placeMediaAt])

  const onDragOver = useCallback((e: React.DragEvent) => {
    // Required so the browser/WebView treats the canvas as a valid drop target
    e.preventDefault()
    e.stopPropagation()
    try {
      e.dataTransfer.dropEffect = 'copy'
    } catch {
      /* some webviews throw if types not set */
    }
    setDropActive(true)
  }, [])

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.dataTransfer.dropEffect = 'copy'
    } catch {
      /* ignore */
    }
    setDropActive(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear overlay when leaving the canvas surface itself
    if (e.currentTarget === e.target) setDropActive(false)
  }, [])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDropActive(false)
      const store = useCanvasStore.getState()
      const local = getLocalPoint(e)
      const world = screenToWorld(local.x, local.y, store.viewport)

      // Unified HTML5 path (browser + desktop with dragDropEnabled:false):
      // files, local paths, remote media URLs, page links, plain text
      const imported = await importDropAt(world.x, world.y, e.dataTransfer)
      if (imported) return

      // Fallback: raw FileList (in case collectClipboardMedia skipped something)
      const files = [...e.dataTransfer.files]
      if (!files.length) return
      await placeMediaAt(
        world.x,
        world.y,
        files.map((file) => ({ kind: 'file' as const, file })),
      )
    },
    [getLocalPoint, placeMediaAt],
  )

  const cursor = modalXformKind
    ? modalXformKind === 'grab'
      ? 'move'
      : modalXformKind === 'rotate'
        ? 'crosshair'
        : 'nwse-resize'
    : effectiveTool === 'pan' || isPanning
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

  /**
   * Parent peer fade (enter + exit) via stackEnterAnim.peerReveal (0..1).
   * Exit: 0 → 1 after ~200ms. Enter: 1 → 0 over 500ms (same ease, reverse).
   * Ghost-render parent peers in stack-local coords while inside the nav stack
   * (and for exit, also after handoff on parent).
   */
  const isEnterAnim = stackEnterAnim?.mode === 'enter'
  const isExitAnim = stackEnterAnim?.mode === 'exit'
  const animStackId = stackEnterAnim?.stackId ?? null
  const animStackRec = animStackId
    ? stacks.find((s) => s.id === animStackId)
    : null
  const animParentId = animStackRec?.parentId ?? null
  /** Exit aliases (kept for embed / handoff branches below) */
  const exitingStackId = isExitAnim ? animStackId : null
  const exitingStackRec = isExitAnim ? animStackRec : null
  const exitParentId = isExitAnim ? animParentId : null
  /** Still inside the nav stack — parent peers not in normal lists yet */
  const exitGhostParent =
    isExitAnim &&
    exitingStackId != null &&
    currentContainerId === exitingStackId &&
    exitParentId != null &&
    exitingStackRec != null
  const enterGhostParent =
    isEnterAnim &&
    animStackId != null &&
    currentContainerId === animStackId &&
    animParentId != null &&
    animStackRec != null
  const peerOpacity =
    isExitAnim || isEnterAnim
      ? Math.max(
          0,
          Math.min(
            1,
            stackEnterAnim?.peerReveal ?? (isEnterAnim ? 1 : 0),
          ),
        )
      : 1
  const exitPeerOpacity = isExitAnim ? peerOpacity : 1
  const enterPeerOpacity = isEnterAnim ? peerOpacity : 1
  /** After handoff: dim peers via peerReveal; exiting stack fan stays solid */
  const exitAfterHandoff =
    isExitAnim &&
    exitingStackId != null &&
    currentContainerId !== exitingStackId
  // Parent free items (non-embed) as stack-local ghosts (enter fade-out / exit fade-in)
  const parentPeerGhostItems = useMemo(() => {
    const ghost = enterGhostParent || exitGhostParent
    const rec = enterGhostParent ? animStackRec : exitingStackRec
    const parentId = enterGhostParent ? animParentId : exitParentId
    if (!ghost || !rec || !parentId) return []
    const ox = rec.x
    const oy = rec.y
    return items
      .filter(
        (i) => containerOf(i) === parentId && i.type !== 'embed',
      )
      .map((i) => ({
        ...i,
        x: i.x - ox,
        y: i.y - oy,
      }))
  }, [
    enterGhostParent,
    exitGhostParent,
    animStackRec,
    exitingStackRec,
    animParentId,
    exitParentId,
    items,
  ])

  // Peer stacks on parent: continuous ghost (folder + fan) during enter/exit.
  const parentPeerGhostStacks = useMemo(() => {
    if (!animStackRec || !animParentId || !animStackId) return []
    if (isEnterAnim) {
      if (currentContainerId !== animStackId) return []
    } else if (isExitAnim) {
      if (
        currentContainerId !== animStackId &&
        currentContainerId !== animParentId
      )
        return []
    } else {
      return []
    }
    const stillInside = currentContainerId === animStackId
    const ox = stillInside ? animStackRec.x : 0
    const oy = stillInside ? animStackRec.y : 0
    return stacks
      .filter((s) => s.parentId === animParentId && s.id !== animStackId)
      .map((stack) => {
        const worldBounds = collapsedStackFolderBounds(stack, items, stacks)
        const fanCards = collapsedStackFanCards(stack, items, stacks)
        const leafItems = collectItemsInStackTree(items, stacks, stack.id)
        const leafZ = leafItems.map((item) => item.zIndex)
        const folderZ =
          Math.min(
            stack.zIndex,
            ...(leafZ.length ? leafZ : [stack.zIndex + 1]),
          ) - 1
        const countZ = Math.max(stack.zIndex, ...leafZ, 1) + 2
        return {
          stack,
          bounds: {
            x: worldBounds.x - ox,
            y: worldBounds.y - oy,
            width: worldBounds.width,
            height: worldBounds.height,
          },
          fanItems: fanCards
            .map((c) => {
              const m = items.find((i) => i.id === c.id)
              if (!m || m.type === 'embed') return null
              return {
                ...m,
                x: c.x - ox,
                y: c.y - oy,
                rotation: c.rotation,
                stacked: true,
                stackGroupId: stack.id,
              } as CanvasItem
            })
            .filter(Boolean) as CanvasItem[],
          count: leafItems.length,
          folderZ,
          countZ,
        }
      })
  }, [
    isEnterAnim,
    isExitAnim,
    animStackRec,
    animParentId,
    animStackId,
    currentContainerId,
    items,
    stacks,
  ])
  const parentPeerGhostStackIds = useMemo(
    () => new Set(parentPeerGhostStacks.map((peer) => peer.stack.id)),
    [parentPeerGhostStacks],
  )
  const exitParentPeerStackIds = parentPeerGhostStackIds
  const navPeerOpacity = isEnterAnim
    ? enterPeerOpacity
    : isExitAnim
      ? exitPeerOpacity
      : 1

  return (
    <div
      ref={surfaceRef}
      className={`canvas-surface ${dropActive ? 'drop-active' : ''} ${cHeld ? 'crop-mode' : ''} ${modalXformKind ? 'modal-xform' : ''} ${isGroupSelect ? 'is-group-select' : ''}`}
      style={{ cursor }}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {modalXformKind && (
        <div className="modal-xform-hud" aria-live="polite">
          {modalXformKind === 'grab' && 'Move (G) — LMB confirm · RMB cancel'}
          {modalXformKind === 'rotate' &&
            'Rotate (R) — Shift 15° · LMB confirm · RMB cancel'}
          {modalXformKind === 'scale' && 'Scale (S) — LMB confirm · RMB cancel'}
        </div>
      )}
      <div
        className="canvas-world"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        <div className="canvas-grid" />
        {/* Folder chrome for nested stacks + legacy groups */}
        {stackFolders.map((f) => {
          // A persistent exit-peer layer below owns this stack until the fade
          // reaches 1. Avoid mounting a second real folder at handoff.
          if (exitParentPeerStackIds.has(f.gid)) return null
          // During exit settle, real folder fades in under morph overlay
          const exitAnim =
            stackEnterAnim?.mode === 'exit' &&
            stackEnterAnim.stackId === f.gid
              ? stackEnterAnim
              : null
          // Other stacks on parent fade in with exit settle (not the one we just left)
          const folderOpacity =
            exitAnim != null
              ? Math.max(0, Math.min(1, exitAnim.settle ?? 0))
              : exitAfterHandoff
                ? exitPeerOpacity
                : 1
          // Leaf items only (nested stack folders are not counted as items)
          const countN = countLeafItemsInStack(items, stacks, f.gid)
          const leafZ = collectItemsInStackTree(items, stacks, f.gid).map(
            (i) => i.zIndex,
          )
          // Folder chrome always under fan cards
          const folderZ =
            Math.min(f.z, ...(leafZ.length ? leafZ : [f.z + 1])) - 1
          const countZ = Math.max(f.z, ...leafZ, 1) + 2
          // Nested child stack chrome (B inside A): fade with enter/exit anim
          const childOfAnim =
            stackEnterAnim &&
            stacks.some(
              (s) =>
                s.id === f.gid && s.parentId === stackEnterAnim.stackId,
            )
          const nestedChrome =
            childOfAnim && stackEnterAnim
              ? Math.max(0, Math.min(1, stackEnterAnim.nestedChromeOpacity ?? 1))
              : 1
          const folderOp = folderOpacity * nestedChrome
          return (
          <Fragment key={`folder-wrap-${f.gid}`}>
          <StackFolder
            groupId={f.gid}
            members={f.members}
            bounds={f.bounds}
            selected={f.selected}
            dropTarget={f.dropTarget}
            zIndex={folderZ}
            name={f.name}
            styleOpacity={folderOp}
            count={countN}
            countZIndex={countZ}
            onEnter={() => {
              if (isInteractionLocked()) return
              const st = useCanvasStore.getState()
              const vp = st.viewport
              // Ensure stack exists as a record (legacy migrate path)
              if (!st.stacks.some((s) => s.id === f.gid) && f.members.length) {
                const live = useCanvasStore.getState()
                const migrated = migrateLegacyStacks(live.items, live.stacks)
                useCanvasStore.setState({
                  items: migrated.items,
                  stacks: migrated.stacks,
                })
              }
              st.enterStack(f.gid, {
                x: f.bounds.x * vp.zoom + vp.x,
                y: f.bounds.y * vp.zoom + vp.y,
                w: f.bounds.width * vp.zoom,
                h: f.bounds.height * vp.zoom,
              })
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              const store = useCanvasStore.getState()
              if (isInteractionLocked()) {
                e.preventDefault()
                e.stopPropagation()
                return
              }
              dismissStackNameEdit()
              blurChrome()
              flushDragWrite()
              if (store.spaceHeld || store.tool === 'pan') return
              if (store.tool === 'scribble' || store.tool === 'erase') return
              e.stopPropagation()

              const additive = e.shiftKey || e.ctrlKey || e.metaKey
              if (f.isRecord) {
                if (additive) {
                  store.selectStacks([f.gid], true)
                } else if (!store.selectedStackIds.includes(f.gid)) {
                  // New primary stack selection (clears free items)
                  store.selectStacks([f.gid])
                }
                // Already multi-selected: keep free items + all selected stacks
                const joint = captureJointMoveSelection(
                  useCanvasStore.getState(),
                )
                if (!joint.stackIds.includes(f.gid)) {
                  joint.stackIds = [...joint.stackIds, f.gid]
                  const st = store.stacks.find((s) => s.id === f.gid)
                  if (st) joint.stackOrigins[f.gid] = { x: st.x, y: st.y }
                }
                dragRef.current = {
                  kind: 'pending-move',
                  itemId: f.gid,
                  isStacked: true,
                  stackGroupId: f.gid,
                  canEditText: false,
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  lastX: e.clientX,
                  lastY: e.clientY,
                  ids: joint.ids,
                  origins: joint.origins,
                  stackIds: joint.stackIds,
                  stackOrigins: joint.stackOrigins,
                  duplicated: false,
                  altHeld: e.altKey,
                }
                surfaceRef.current?.setPointerCapture(e.pointerId)
                return
              }
              // Legacy: drag via proxy members
              if (f.proxy) onItemPointerDown(e, f.proxy)
            }}
          />
          {/* Count above fan cards — same anchor as .stack-folder-label (right:12 bottom:10) */}
          {countN > 0 && folderOp > 0.05 && (
            <span
              className="stack-folder-label stack-count-float"
              style={{
                // Bottom-right of badge at folder corner inset (matches morph chrome)
                transform: `translate(${f.bounds.x + f.bounds.width - 12}px, ${
                  f.bounds.y + f.bounds.height - 10
                }px) translate(-100%, -100%)`,
                zIndex: countZ,
                opacity: folderOp,
                pointerEvents: 'none',
              }}
            >
              {countN}
            </span>
          )}
          </Fragment>
          )
        })}
        {/*
          Parent peers (enter fade-out / exit fade-in): continuous ghost layer
          so container switch never pops same-level items off instantly.
        */}
        {parentPeerGhostStacks.map((peer) => (
          <Fragment key={`peer-ghost-stack-${peer.stack.id}`}>
            <StackFolder
              groupId={peer.stack.id}
              members={[]}
              bounds={peer.bounds}
              selected={false}
              zIndex={peer.folderZ}
              name={peer.stack.name}
              styleOpacity={navPeerOpacity}
              count={peer.count}
              countZIndex={peer.countZ}
              onPointerDown={() => {}}
            />
            {peer.count > 0 && navPeerOpacity > 0.05 && (
              <span
                className="stack-folder-label stack-count-float"
                style={{
                  transform: `translate(${peer.bounds.x + peer.bounds.width - 12}px, ${
                    peer.bounds.y + peer.bounds.height - 10
                  }px) translate(-100%, -100%)`,
                  zIndex: peer.countZ,
                  opacity: navPeerOpacity,
                  pointerEvents: 'none',
                }}
              >
                {peer.count}
              </span>
            )}
            {peer.fanItems.map((item) => (
              <div
                key={`peer-ghost-fan-${item.id}`}
                className="stack-preview-wrap"
                style={{
                  opacity: navPeerOpacity,
                  pointerEvents: 'none',
                }}
              >
                <CanvasItemView
                  item={item}
                  selected={false}
                  onPointerDown={() => {}}
                  onResizePointerDown={() => {}}
                />
              </div>
            ))}
          </Fragment>
        ))}
        {parentPeerGhostItems.map((item) => (
          <div
            key={`peer-ghost-item-${item.id}`}
            className="peer-fade-wrap"
            style={{
              opacity: navPeerOpacity,
              pointerEvents: 'none',
            }}
          >
            <CanvasItemView
              item={item}
              selected={false}
              onPointerDown={() => {}}
              onResizePointerDown={() => {}}
            />
          </div>
        ))}
        {stackPreviewItems.map((item) => {
          // Ghost layer owns peer-stack fan cards during enter/exit — hide real ones
          const isPeerGhostPreview =
            item.stackGroupId != null &&
            parentPeerGhostStackIds.has(item.stackGroupId)
          if (isPeerGhostPreview) return null
          return (
            <div
              key={item.id}
              className="stack-preview-wrap"
              style={{ opacity: 1 }}
            >
              <CanvasItemView
                item={item}
                selected={
                  !!(
                    item.stackGroupId &&
                    selectedStackSet.has(item.stackGroupId)
                  )
                }
                onPointerDown={(e, it) => {
                  // Stacked previews use pointer-events:none — hits go to folder.
                  // Keep handler for legacy paths / safety.
                  if (e.button !== 0) return
                  const gid = it.stackGroupId
                  if (!gid) return
                  const store = useCanvasStore.getState()
                  if (isInteractionLocked()) {
                    e.preventDefault()
                    e.stopPropagation()
                    return
                  }
                  dismissStackNameEdit()
                  blurChrome()
                  flushDragWrite()
                  if (store.spaceHeld || store.tool === 'pan') return
                  if (store.tool === 'scribble' || store.tool === 'erase') return
                  e.stopPropagation()

                  if (e.detail >= 2) {
                    const vp = store.viewport
                    const folder = store.stacks.find((s) => s.id === gid)
                    if (folder) {
                      store.enterStack(gid, {
                        x: folder.x * vp.zoom + vp.x,
                        y: folder.y * vp.zoom + vp.y,
                        w: folder.width * vp.zoom,
                        h: folder.height * vp.zoom,
                      })
                    }
                    return
                  }

                  const additive = e.shiftKey || e.ctrlKey || e.metaKey
                  if (additive) store.selectStacks([gid], true)
                  else if (!store.selectedStackIds.includes(gid)) {
                    store.selectStacks([gid])
                  }
                  const joint = captureJointMoveSelection(
                    useCanvasStore.getState(),
                  )
                  if (!joint.stackIds.includes(gid)) {
                    joint.stackIds = [...joint.stackIds, gid]
                    const st = store.stacks.find((s) => s.id === gid)
                    if (st) joint.stackOrigins[gid] = { x: st.x, y: st.y }
                  }
                  dragRef.current = {
                    kind: 'pending-move',
                    itemId: gid,
                    isStacked: true,
                    stackGroupId: gid,
                    canEditText: false,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    lastX: e.clientX,
                    lastY: e.clientY,
                    ids: joint.ids,
                    origins: joint.origins,
                    stackIds: joint.stackIds,
                    stackOrigins: joint.stackOrigins,
                    duplicated: false,
                    altHeld: e.altKey,
                  }
                  surfaceRef.current?.setPointerCapture(e.pointerId)
                }}
                onResizePointerDown={() => {
                  /* previews are not resizable */
                }}
              />
            </div>
          )
        })}
        {sortedNonEmbeds.map((item) => (
          <div
            key={item.id}
            className="peer-fade-wrap"
            style={{
              opacity: exitAfterHandoff ? exitPeerOpacity : 1,
            }}
          >
            <CanvasItemView
              item={item}
              selected={selectedSet.has(item.id)}
              onPointerDown={onItemPointerDown}
              onResizePointerDown={onResizePointerDown}
            />
          </div>
        ))}
        {/* Multi-select group bounding box (2+ free items and/or stacks) */}
        {isGroupSelect && groupBounds && !stackEnterAnim && (
          <div
            className="group-selection-box"
            style={{
              transform: `translate(${groupBounds.x}px, ${groupBounds.y}px)`,
              width: groupBounds.width,
              height: groupBounds.height,
              zIndex: 100000,
              // Hold C for crop: let events pass through to canvas surface
              pointerEvents: cHeld ? 'none' : 'auto',
            }}
            onPointerDown={(e) => {
              // Drag the group by grabbing the box fill (not corners/edges)
              if (e.button !== 0) return
              const store = useCanvasStore.getState()
              // Never steal crop / pan gestures
              if (store.cHeld || store.spaceHeld || store.tool === 'pan') return
              if (
                (e.target as HTMLElement).closest?.(
                  '.group-scale-handle, .group-scale-edge',
                )
              )
                return
              e.stopPropagation()
              if (isInteractionLocked()) return
              dismissStackNameEdit()
              blurChrome()
              flushDragWrite()
              const joint = captureJointMoveSelection(store)
              if (joint.ids.length === 0 && joint.stackIds.length === 0) return
              dragRef.current = {
                kind: 'pending-move',
                itemId: joint.ids[0] || joint.stackIds[0] || 'group',
                isStacked: false,
                canEditText: false,
                startClientX: e.clientX,
                startClientY: e.clientY,
                lastX: e.clientX,
                lastY: e.clientY,
                ids: joint.ids,
                origins: joint.origins,
                stackIds: joint.stackIds,
                stackOrigins: joint.stackOrigins,
                duplicated: false,
                altHeld: e.altKey,
              }
              surfaceRef.current?.setPointerCapture(e.pointerId)
            }}
          >
            {(['n', 'e', 's', 'w'] as GroupScaleHandle[]).map((h) => (
              <div
                key={h}
                className={`group-scale-edge edge-${h}`}
                onPointerDown={(e) => onGroupScalePointerDown(e, h)}
              />
            ))}
            {(['nw', 'ne', 'sw', 'se'] as GroupScaleHandle[]).map((h) => (
              <div
                key={h}
                className={`group-scale-handle handle-${h}`}
                onPointerDown={(e) => onGroupScalePointerDown(e, h)}
              />
            ))}
          </div>
        )}
        {/*
          Embed keepalive: every embed stays mounted for the board lifetime.
          Only pose/visibility change on stack enter/exit — iframe never remounts.
        */}
        {allEmbedItems.map((item) => {
          let pose = resolveEmbedWorldPose(
            item,
            currentContainerId,
            stacks,
          )
          // Enter/exit: also show free embeds living on the parent (ghost)
          if (
            (exitGhostParent || enterGhostParent) &&
            animStackRec &&
            animParentId &&
            !pose.visible
          ) {
            const parentPose = resolveEmbedWorldPose(
              item,
              animParentId,
              stacks,
            )
            if (parentPose.visible) {
              pose = {
                ...parentPose,
                x: parentPose.x - animStackRec.x,
                y: parentPose.y - animStackRec.y,
              }
            }
          }
          const display = embedDisplayItem(item, pose)
          const isExitingFan =
            pose.asPreview && pose.stackGroupId === exitingStackId
          const isPeerGhostPreview =
            pose.asPreview &&
            pose.stackGroupId != null &&
            parentPeerGhostStackIds.has(pose.stackGroupId)
          const embedOp = !pose.visible
            ? 0
            : isExitingFan
              ? 1
              : isPeerGhostPreview
                ? navPeerOpacity
              : exitGhostParent || enterGhostParent || exitAfterHandoff
                ? // Free on current stack (inner members): full; parent ghosts: peer fade
                  containerOf(item) === currentContainerId && !pose.asPreview
                  ? 1
                  : navPeerOpacity
                : 1
          return (
            <div
              key={item.id}
              className={`embed-alive ${pose.visible ? 'is-shown' : 'is-hidden'}`}
              style={{ opacity: pose.visible ? embedOp : undefined }}
              aria-hidden={!pose.visible}
            >
              <CanvasItemView
                item={display}
                selected={
                  pose.visible &&
                  !pose.asPreview &&
                  selectedSet.has(item.id) &&
                  !exitGhostParent
                }
                onPointerDown={onItemPointerDown}
                onResizePointerDown={onResizePointerDown}
              />
            </div>
          )
        })}
      </div>

      {visibleItems.length === 0 &&
        visibleStacks.length === 0 &&
        currentContainerId === ROOT_CONTAINER_ID && <EmptyState />}

      {/* Stack folder morph: screen-space outer rect, world-scale chrome (matches canvas zoom) */}
      {stackEnterAnim && (
        <div className="stack-enter-overlay" aria-hidden>
          {(() => {
            const t = stackEnterAnim.t
            const settle = stackEnterAnim.settle ?? 0
            const a = stackEnterAnim.start
            const vw = window.innerWidth
            const vh = window.innerHeight
            const b =
              stackEnterAnim.end ??
              (stackEnterAnim.mode === 'enter'
                ? { x: 0, y: 0, w: vw, h: vh }
                : a)
            const x = a.x + (b.x - a.x) * t
            const y = a.y + (b.y - a.y) * t
            const w = Math.max(1, a.w + (b.w - a.w) * t)
            const h = Math.max(1, a.h + (b.h - a.h) * t)
            /*
             * CRITICAL scale match: real StackFolder lives inside .canvas-world
             * (transform scale(zoom)), so tab / badge / radius are in world units.
             * Morph is a surface overlay — if we paint CSS px at screen size, chrome
             * looks larger whenever zoom < 1. Layout in world units then scale(zoom).
             */
            const zoom = Math.max(0.05, viewport.zoom)
            const worldW = w / zoom
            const worldH = h / zoom
            /*
             * Enter: expand + fade out together — fully transparent at full-screen edge.
             * Exit: fade in with shrink, then settle crossfades to real folder.
             */
            const smooth = (u: number) => u * u * (3 - 2 * u) // smoothstep
            const clamp01 = (u: number) => Math.max(0, Math.min(1, u))
            // Enter: hit full transparency slightly before t=1 so edge is clean
            const enterFade = clamp01(t / 0.92)
            const baseOp =
              stackEnterAnim.mode === 'exit'
                ? smooth(clamp01(t))
                : 1 - smooth(enterFade)
            const opacity =
              stackEnterAnim.mode === 'exit'
                ? baseOp * (1 - smooth(clamp01(settle)))
                : baseOp
            // Tab + count: enter rides parent opacity; exit trails body then settle-out
            const detailT =
              stackEnterAnim.mode === 'exit'
                ? clamp01((t - 0.08) / 0.92)
                : 1
            const detailOp =
              stackEnterAnim.mode === 'exit'
                ? smooth(detailT) * (1 - smooth(clamp01(settle)))
                : 1
            const hasName = !!(stackEnterAnim.name || '').trim()
            const count = stackEnterAnim.memberCount ?? 0
            return (
              <div
                className={`stack-enter-folder stack-folder-morph ${
                  stackEnterAnim.mode === 'exit' ? 'is-exit' : 'is-enter'
                } ${hasName ? 'has-name' : 'is-compact'}`}
                style={{
                  left: x,
                  top: y,
                  width: worldW,
                  height: worldH,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  opacity,
                }}
              >
                <div
                  className={`stack-folder-tab ${
                    hasName ? 'is-expanded' : 'is-compact'
                  }`}
                  style={{ opacity: detailOp }}
                >
                  {hasName && (
                    <span className="stack-folder-tab-label">
                      {stackEnterAnim.name}
                    </span>
                  )}
                </div>
                {/* Body fill — height from top offset; parent opacity drives fade */}
                <div className="stack-folder-body" />
                {count > 0 && (
                  <span
                    className="stack-folder-label"
                    style={{ opacity: detailOp }}
                  >
                    {count}
                  </span>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {marquee && (
        <div
          className={`marquee ${tool === 'textcard' ? 'create-note' : ''}`}
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.w,
            height: marquee.h,
          }}
        />
      )}

      {cropOverlay && (
        <div
          className="crop-rect"
          style={{
            left: cropOverlay.x,
            top: cropOverlay.y,
            width: cropOverlay.w,
            height: cropOverlay.h,
          }}
        />
      )}

      {snapGuides.map((g, i) => {
        if (g.orientation === 'v') {
          const sx = g.pos * viewport.zoom + viewport.x
          return <div key={`sg-${i}`} className="snap-guide v" style={{ left: sx }} />
        }
        const sy = g.pos * viewport.zoom + viewport.y
        return <div key={`sg-${i}`} className="snap-guide h" style={{ top: sy }} />
      })}

      {dropActive && (
        <div className="drop-overlay">Drop media, URL, or text</div>
      )}
    </div>
  )
}
