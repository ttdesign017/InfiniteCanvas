import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { CanvasItemView } from './items/CanvasItemView'
import { EmptyState } from './EmptyState'
import { StackFolder } from './StackFolder'
import type { CanvasItem, MediaItem } from '../types/canvas'
import {
  expandStackSelection,
  hitStackGroupAt,
  placeItemsTight,
  screenToWorld,
  stackGroupBounds,
} from '../utils/layout'
import { createMediaFromFile, createMediaFromPath } from '../utils/media'
import { importDropAt } from '../utils/dropImport'
import { computeResize, isEdgeResizeType } from '../utils/resize'
import {
  computeSnapDelta,
  guidesEqual,
  snapResizeRect,
  type SnapGuide,
} from '../utils/snap'
import { isDesktop, onNativeFileDrop } from '../utils/desktop'
import {
  clearTextScalePreview,
  getTextScalePreview,
  originFromHandle,
  scaledBoxFromPreview,
  setTextScalePreview,
} from '../utils/textScalePreview'

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
      startClientX: number
      startClientY: number
      lastX: number
      lastY: number
      ids: string[]
      origins: Record<string, { x: number; y: number }>
      duplicated: boolean
      altHeld: boolean
    }
  | {
      kind: 'move'
      ids: string[]
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
  | { kind: 'scribble'; id: string }
  | { kind: 'erase'; erased: boolean }
  | {
      kind: 'crop'
      id: string
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

function isMedia(item: CanvasItem): item is MediaItem {
  return item.type === 'image' || item.type === 'gif' || item.type === 'video'
}

function hitMediaAt(world: { x: number; y: number }, items: CanvasItem[]): MediaItem | null {
  const media = items.filter(isMedia).sort((a, b) => b.zIndex - a.zIndex)
  for (const m of media) {
    if (
      world.x >= m.x &&
      world.y >= m.y &&
      world.x <= m.x + m.width &&
      world.y <= m.y + m.height
    ) {
      return m
    }
  }
  return null
}

/** Crop target: media under cursor, else topmost selected media */
function resolveCropTarget(
  world: { x: number; y: number },
  items: CanvasItem[],
  selectedIds: string[],
): MediaItem | null {
  const hit = hitMediaAt(world, items)
  if (hit) return hit
  const selected = items
    .filter(isMedia)
    .filter((i) => selectedIds.includes(i.id))
    .sort((a, b) => b.zIndex - a.zIndex)
  return selected[0] ?? null
}

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

  const items = useCanvasStore((s) => s.items)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const viewport = useCanvasStore((s) => s.viewport)
  const tool = useCanvasStore((s) => s.tool)
  const spaceHeld = useCanvasStore((s) => s.spaceHeld)
  const cHeld = useCanvasStore((s) => s.cHeld)
  const isPanning = useCanvasStore((s) => s.isPanning)

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.zIndex - b.zIndex),
    [items],
  )
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const effectiveTool = spaceHeld ? 'pan' : cHeld ? 'crop' : tool

  const stackFolders = useMemo(() => {
    const groups = new Map<string, CanvasItem[]>()
    for (const it of items) {
      if (!it.stackGroupId || !it.stacked) continue
      const list = groups.get(it.stackGroupId) || []
      list.push(it)
      groups.set(it.stackGroupId, list)
    }
    return [...groups.entries()].map(([gid, members]) => {
      const b = stackGroupBounds(members)
      if (!b) return null
      return {
        gid,
        members,
        bounds: b,
        selected: members.some((m) => selectedSet.has(m.id)),
        dropTarget: stackDropTargetId === gid,
        z: Math.min(...members.map((m) => m.zIndex)) - 1,
        proxy: members[0],
      }
    }).filter(Boolean) as Array<{
      gid: string
      members: CanvasItem[]
      bounds: { x: number; y: number; width: number; height: number }
      selected: boolean
      dropTarget: boolean
      z: number
      proxy: CanvasItem
    }>
  }, [items, selectedSet, stackDropTargetId])

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

  /** End layout animation so it cannot overwrite manual moves */
  const cancelLayoutAnimation = () => {
    if (useCanvasStore.getState().animating) {
      useCanvasStore.setState({ animating: false })
    }
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
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent, item: CanvasItem, handle: string) => {
      if (e.button !== 0) return
      const store = useCanvasStore.getState()
      if (item.stacked && item.stackGroupId) return

      dismissStackNameEdit()
      blurChrome()
      cancelLayoutAnimation()
      flushDragWrite()

      if (store.spaceHeld || store.tool === 'pan') return
      if (store.tool === 'scribble' || store.tool === 'erase') return

      const live = store.items.find((i) => i.id === item.id) ?? item
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

  const enterStackRename = (groupId: string, itemId: string) => {
    const store = useCanvasStore.getState()
    const expanded = expandStackSelection([itemId], store.items)
    store.select(expanded)
    useCanvasStore.setState({
      editingStackGroupId: groupId,
      editingId: null,
    })
  }

  const onItemPointerDown = useCallback(
    (e: React.PointerEvent, item: CanvasItem) => {
      if (e.button !== 0) return
      // Handles have their own handler with stopPropagation — if we get here,
      // this is a body click (move), not a resize handle.
      if ((e.target as HTMLElement).closest?.('[data-handle]')) return

      const store = useCanvasStore.getState()

      dismissStackNameEdit()
      blurChrome()
      cancelLayoutAnimation()
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
        const target = resolveCropTarget(world, store.items, store.selectedIds)
        if (!target) return
        if (!store.selectedIds.includes(target.id)) {
          store.select([target.id])
        }
        dragRef.current = {
          kind: 'crop',
          id: target.id,
          startWorld: { ...world },
          currentWorld: { ...world },
        }
        surfaceRef.current?.setPointerCapture(e.pointerId)
        setCropOverlay({ x: local.x, y: local.y, w: 0, h: 0 })
        return
      }

      e.stopPropagation()

      // Double-click (detail>=2): enter edit immediately — never start a drag
      if (e.detail >= 2) {
        if (canEditText) {
          enterTextEdit(item.id)
          return
        }
        if (isStacked && item.stackGroupId) {
          enterStackRename(item.stackGroupId, item.id)
          return
        }
      }

      // While editing this item, clicks stay for text selection
      if (
        canEditText &&
        store.editingId === item.id
      ) {
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

      let moveIds = expandStackSelection(ids, useCanvasStore.getState().items)
      if (moveIds.length === 0) return

      let duplicated = false
      if (e.altKey) {
        // Alt-drag duplicate: promote immediately (user intent is drag)
        store.pushHistory()
        moveIds = store.duplicateItems(moveIds)
        duplicated = true
      }
      const live = useCanvasStore.getState().items
      const origins: Record<string, { x: number; y: number }> = {}
      for (const id of moveIds) {
        const it = live.find((i) => i.id === id)
        if (it) origins[id] = { x: it.x, y: it.y }
      }
      if (Object.keys(origins).length === 0) return

      // Pending until movement exceeds threshold — preserves double-click edit
      dragRef.current = {
        kind: 'pending-move',
        itemId: item.id,
        isStacked,
        stackGroupId: item.stackGroupId,
        canEditText,
        startClientX: e.clientX,
        startClientY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        ids: moveIds,
        origins,
        duplicated,
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

      if (holdingSpace || store.tool === 'pan') {
        store.setIsPanning(true)
        dragRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY }
        surfaceRef.current?.setPointerCapture(e.pointerId)
        return
      }

      // PureRef-style crop: hold C + drag anywhere (uses selected media if start is outside)
      if (holdingC) {
        const media = resolveCropTarget(world, store.items, store.selectedIds)
        if (media) {
          // Preserve selection — never clear while cropping
          if (!store.selectedIds.includes(media.id)) {
            store.select([media.id])
          }
          dragRef.current = {
            kind: 'crop',
            id: media.id,
            startWorld: { ...world },
            currentWorld: { ...world },
          }
          setCropOverlay({ x: local.x, y: local.y, w: 0, h: 0 })
          surfaceRef.current?.setPointerCapture(e.pointerId)
          return
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
        // Real drag: push history once, then switch to move mode
        store.pushHistory()
        // Leave text edit if any
        if (store.editingId) {
          useCanvasStore.setState({ editingId: null })
        }
        dragRef.current = {
          kind: 'move',
          ids: drag.ids,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: true,
          duplicated: drag.duplicated,
          altHeld: drag.altHeld,
          origins: drag.origins,
          accDx: 0,
          accDy: 0,
        }
        lastItemClickRef.current = null
        // fall through into move handling with zero delta this frame
        return
      }

      if (drag.kind === 'move') {
        if (e.altKey && !drag.duplicated && !drag.moved) {
          const newIds = store.duplicateItems(drag.ids)
          drag.ids = newIds
          drag.duplicated = true
          drag.altHeld = true
          const live = store.items
          drag.origins = {}
          for (const id of newIds) {
            const it = live.find((i) => i.id === id)
            if (it) drag.origins[id] = { x: it.x, y: it.y }
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
          if (snapOn) {
            const threshold = 10 / Math.max(0.01, st.viewport.zoom || 1)
            const snap = computeSnapDelta(freeTargets, st.items, threshold)
            finalDx += snap.dx
            finalDy += snap.dy
            guides = snap.guides
          }

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
          setSnapGuides((prev) => (guidesEqual(prev, guides) ? prev : guides))

          // Merge highlight: free materials over a stack folder
          const liveItems = useCanvasStore.getState().items
          const draggingStacked = ids.some((id) => {
            const it = liveItems.find((i) => i.id === id)
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
            const hit = hitStackGroupAt(world, liveItems, { excludeIds: ids })
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
          } else if (drag.isStacked && drag.stackGroupId) {
            enterStackRename(drag.stackGroupId, drag.itemId)
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
      if (width > 8 && height > 8) {
        store.applyCrop(drag.id, { x, y, width, height })
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
        const hit = store.items
          .filter((item) => {
            return (
              item.x < worldRect.x + worldRect.w &&
              item.x + item.width > worldRect.x &&
              item.y < worldRect.y + worldRect.h &&
              item.y + item.height > worldRect.y
            )
          })
          .map((i) => i.id)
        const expanded = expandStackSelection(hit, store.items)

        if (additive) {
          store.select([...new Set([...store.selectedIds, ...expanded])])
        } else {
          store.select(expanded)
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

  // Tauri/WebView2: OS file drops come via native drag-drop events, not HTML5 FileList
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
      // drop — position is logical px relative to webview top-left
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
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }, [])

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
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

      // Browser / HTML5 drop: URLs → bookmarks, media → images/videos, text → notes
      // (also handles file FileList when the webview provides it)
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

  const cursor =
    effectiveTool === 'pan' || isPanning
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

  return (
    <div
      ref={surfaceRef}
      className={`canvas-surface ${dropActive ? 'drop-active' : ''} ${cHeld ? 'crop-mode' : ''}`}
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
      <div
        className="canvas-world"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        <div className="canvas-grid" />
        {/* Folder chrome behind each stack group */}
        {stackFolders.map((f) => (
          <StackFolder
            key={`folder-${f.gid}`}
            groupId={f.gid}
            members={f.members}
            bounds={f.bounds}
            selected={f.selected}
            dropTarget={f.dropTarget}
            zIndex={f.z}
            onPointerDown={(e) => {
              if (!f.proxy) return
              onItemPointerDown(e, f.proxy)
            }}
          />
        ))}
        {sortedItems.map((item) => (
          <CanvasItemView
            key={item.id}
            item={item}
            selected={selectedSet.has(item.id)}
            onPointerDown={onItemPointerDown}
            onResizePointerDown={onResizePointerDown}
          />
        ))}
      </div>

      {items.length === 0 && <EmptyState />}

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
