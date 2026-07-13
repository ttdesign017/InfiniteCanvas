import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { CanvasItemView } from './items/CanvasItemView'
import { EmptyState } from './EmptyState'
import type { CanvasItem, MediaItem } from '../types/canvas'
import {
  expandStackSelection,
  placeItemsTight,
  screenToWorld,
  stackGroupBounds,
} from '../utils/layout'
import { createMediaFromFile, createMediaFromPath } from '../utils/media'
import { computeResize, isEdgeResizeType } from '../utils/resize'
import { computeSnapDelta, snapResizeRect, type SnapGuide } from '../utils/snap'
import { isDesktop, onNativeFileDrop } from '../utils/desktop'
import {
  clearTextScalePreview,
  getTextScalePreview,
  originFromHandle,
  scaledBoxFromPreview,
  setTextScalePreview,
} from '../utils/textScalePreview'

type DragMode =
  | null
  | { kind: 'pan'; lastX: number; lastY: number }
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
  /** Window-level listeners while resizing (survives re-render / capture loss) */
  const resizeWinCleanup = useRef<(() => void) | null>(null)
  const eraseHistoryPushed = useRef(false)
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

  const items = useCanvasStore((s) => s.items)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const viewport = useCanvasStore((s) => s.viewport)
  const tool = useCanvasStore((s) => s.tool)
  const spaceHeld = useCanvasStore((s) => s.spaceHeld)
  const cHeld = useCanvasStore((s) => s.cHeld)
  const isPanning = useCanvasStore((s) => s.isPanning)

  const sortedItems = [...items].sort((a, b) => a.zIndex - b.zIndex)
  const selectedSet = new Set(selectedIds)
  const effectiveTool = spaceHeld ? 'pan' : cHeld ? 'crop' : tool

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

  const onItemPointerDown = useCallback(
    (e: React.PointerEvent, item: CanvasItem) => {
      if (e.button !== 0) return
      const store = useCanvasStore.getState()
      blurChrome()

      if (store.spaceHeld || store.tool === 'pan') return
      if (store.tool === 'scribble' || store.tool === 'erase') return

      // Crop mode (hold C): never move/deselect; surface + item both start crop
      if (store.cHeld) {
        e.stopPropagation()
        e.preventDefault()
        const local = getLocalPoint(e)
        const world = screenToWorld(local.x, local.y, store.viewport)
        const target = resolveCropTarget(world, store.items, store.selectedIds)
        if (!target) return
        // Keep existing multi-selection if target already selected; otherwise select target only
        if (!store.selectedIds.includes(target.id)) {
          store.select([target.id])
        }
        dragRef.current = {
          kind: 'crop',
          id: target.id,
          startWorld: { ...world },
          currentWorld: { ...world },
        }
        // Capture on surface so move/up always reach crop handlers
          surfaceRef.current?.setPointerCapture(e.pointerId)
        setCropOverlay({ x: local.x, y: local.y, w: 0, h: 0 })
        return
      }

      const handle = (e.target as HTMLElement).closest('[data-handle]') as HTMLElement | null

      e.stopPropagation()
      // Do not preventDefault — it blocks double-click edit on text/note cards

      // Stacked items are frozen as a group — no edit / resize / per-item UI
      const isStacked = !!(item.stacked && item.stackGroupId)

      // Second click of a double-click: enter edit, don't start a drag
      if (
        !isStacked &&
        e.detail >= 2 &&
        (item.type === 'text' || item.type === 'textcard')
      ) {
        store.select([item.id])
        store.setEditingId(item.id)
        return
      }

      // While editing this item, clicks inside stay for text selection
      if (
        !isStacked &&
        store.editingId === item.id &&
        (item.type === 'text' || item.type === 'textcard')
      ) {
        return
      }

      if (handle && !isStacked) {
        e.preventDefault()
        e.stopPropagation()
        const h = (handle.dataset.handle || 'se').toLowerCase()
        // Text / note / link: edge handles move one side only
        // Media: edges scale uniformly
        const edgeMode: 'scale' | 'edge' = isEdgeResizeType(item.type)
          ? 'edge'
          : 'scale'
        const isMedia =
          item.type === 'image' || item.type === 'gif' || item.type === 'video'
        const isText = item.type === 'text'
        const live = store.items.find((i) => i.id === item.id) ?? item
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
          isMedia,
          isText,
          origFontSize:
            isText && live.type === 'text' ? live.fontSize : undefined,
        }

        if (!store.selectedIds.includes(live.id)) {
          store.select([live.id])
        }
        store.pushHistory()

        // Window capture path — single owner of resize
        resizeWinCleanup.current?.()
        clearTextScalePreview()

        /** Commit text CSS-scale preview into store (idempotent). */
        const commitTextScaleAndEnd = () => {
          const drag = dragRef.current
          if (!drag || drag.kind !== 'resize') {
            clearTextScalePreview()
            return
          }

          if (drag.isText && drag.origFontSize && drag.orig.width > 1) {
            const p = getTextScalePreview()
            const scale =
              p && p.id === drag.id
                ? p.scale
                : drag.textScaleActive && drag.lastTextScale
                  ? drag.lastTextScale
                  : null

            if (scale != null && Math.abs(scale - 1) > 0.001) {
              const origin = originFromHandle(drag.handle)
              const box = scaledBoxFromPreview({
                id: drag.id,
                scale,
                origin,
                baseX: drag.orig.x,
                baseY: drag.orig.y,
                baseW: drag.orig.width,
                baseH: drag.orig.height,
                baseFont: drag.origFontSize,
              })
              // One atomic write so hit-box + font match the visual
              useCanvasStore.getState().updateItem(drag.id, {
                x: box.x,
                y: box.y,
                width: Math.max(24, box.width),
                height: Math.max(24, box.height),
                fontSize: Math.max(8, Math.min(200, Math.round(box.fontSize))),
              })
            }
          }

          clearTextScalePreview()
          // Detach listeners first so we don't re-enter
          const cleanup = resizeWinCleanup.current
          resizeWinCleanup.current = null
          cleanup?.()
          if (dragRef.current?.kind === 'resize') {
            dragRef.current = null
          }
          setSnapGuides([])
        }

        const onWinMove = (ev: PointerEvent) => {
          const drag = dragRef.current
          if (!drag || drag.kind !== 'resize') return
          const st = useCanvasStore.getState()
          const zoom = Math.max(0.01, st.viewport.zoom)
          const dx = (ev.clientX - drag.startX) / zoom
          const dy = (ev.clientY - drag.startY) / zoom
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) return

          const isCorner = drag.handle.length === 2
          const shift = ev.shiftKey

          /**
           * Exclusive paths:
           * - Text corner + no Shift → free box (no font change)
           * - Text corner + Shift     → CSS transform scale preview (no reflow);
           *                              commit font+box on pointerup
           * - Media edge / corner     → proportional (Shift frees corner)
           * - Note/link               → edge = one side; corner = free box
           */
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
          if (st.snapEnabled) {
            const snapped = snapResizeRect(
              next,
              drag.handle,
              drag.id,
              st.items,
              10,
              keepAspect ? aspect : undefined,
            )
            next = snapped.rect
            setSnapGuides(snapped.guides)
          } else {
            setSnapGuides([])
          }

          const w = Math.max(24, next.width)
          const h = Math.max(24, next.height)

          if (textLiveScale && drag.origFontSize && drag.orig.width > 1) {
            // Smooth path: only CSS transform — zero fontSize writes mid-drag
            const scale = Math.max(0.05, w / drag.orig.width)
            drag.lastTextScale = scale
            drag.textScaleActive = true
            setTextScalePreview({
              id: drag.id,
              scale,
              origin: originFromHandle(drag.handle),
              baseX: drag.orig.x,
              baseY: drag.orig.y,
              baseW: drag.orig.width,
              baseH: drag.orig.height,
              baseFont: drag.origFontSize,
            })
            return
          }

          st.resizeItem(drag.id, w, h, next.x, next.y)
        }

        const onWinUp = () => {
          commitTextScaleAndEnd()
        }
        window.addEventListener('pointermove', onWinMove, true)
        window.addEventListener('pointerup', onWinUp, true)
        window.addEventListener('pointercancel', onWinUp, true)
        resizeWinCleanup.current = () => {
          window.removeEventListener('pointermove', onWinMove, true)
          window.removeEventListener('pointerup', onWinUp, true)
          window.removeEventListener('pointercancel', onWinUp, true)
        }
        return
      }

      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)

      const additive = e.shiftKey || e.ctrlKey || e.metaKey
      let ids = store.selectedIds
      if (additive) {
        store.select([item.id], true)
        ids = useCanvasStore.getState().selectedIds
      } else if (!store.selectedIds.includes(item.id)) {
        // Selecting one member of a stack selects the whole stack
        const expanded = expandStackSelection([item.id], store.items)
        store.select(expanded)
        ids = expanded
      } else {
        // Keep selection; clear edit if switching to move
        if (store.editingId) store.setEditingId(null)
        ids = expandStackSelection(store.selectedIds, store.items)
        if (ids.length !== store.selectedIds.length) store.select(ids)
      }

      store.pushHistory()
      // Always move entire stack groups together
      let moveIds = expandStackSelection(ids, useCanvasStore.getState().items)
      let duplicated = false
      if (e.altKey) {
        moveIds = store.duplicateItems(moveIds)
        duplicated = true
      }
      const live = useCanvasStore.getState().items
      const origins: Record<string, { x: number; y: number }> = {}
      for (const id of moveIds) {
        const it = live.find((i) => i.id === id)
        if (it) origins[id] = { x: it.x, y: it.y }
      }
      dragRef.current = {
        kind: 'move',
        ids: moveIds,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        duplicated,
        altHeld: e.altKey,
        origins,
        accDx: 0,
        accDy: 0,
      }
    },
    [getLocalPoint],
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

      if (drag.kind === 'move') {
        // Late Alt press while dragging (before first move) also duplicates
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
        const zoom = store.viewport.zoom
        const dx = (e.clientX - drag.lastX) / zoom
        const dy = (e.clientY - drag.lastY) / zoom
        if (dx !== 0 || dy !== 0) {
          drag.accDx += dx
          drag.accDy += dy
          drag.moved = true

          // Free target from drag-start origins.
          // Keep stacked / stackGroupId so snap uses folder bounds as one unit.
          const freeTargets = drag.ids.map((id) => {
            const o = drag.origins[id]
            const it = store.items.find((i) => i.id === id)
            return {
              id,
              x: (o?.x ?? it?.x ?? 0) + drag.accDx,
              y: (o?.y ?? it?.y ?? 0) + drag.accDy,
              width: it?.width ?? 0,
              height: it?.height ?? 0,
              type: it?.type ?? 'text',
              rotation: it?.rotation ?? 0,
              zIndex: it?.zIndex ?? 0,
              stacked: it?.stacked,
              stackGroupId: it?.stackGroupId,
            } as CanvasItem
          })

          let finalDx = drag.accDx
          let finalDy = drag.accDy
          if (store.snapEnabled) {
            const { dx: sx, dy: sy, guides } = computeSnapDelta(freeTargets, store.items)
            finalDx += sx
            finalDy += sy
            setSnapGuides(guides)
          } else {
            setSnapGuides([])
          }

          // Set absolute positions from origins + snapped free delta
          store.updateItems(
            drag.ids.map((id) => {
              const o = drag.origins[id]
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
        drag.lastX = e.clientX
        drag.lastY = e.clientY
        return
      }

      // Resize is owned only by window listeners — avoid double-apply flicker
      if (drag.kind === 'resize') {
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
    [getLocalPoint],
  )

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current
    const store = useCanvasStore.getState()

    // Resize: commit text scale if window listener lost the race, then end
    if (drag?.kind === 'resize') {
      // Same commit path as window pointerup (idempotent)
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
      const cleanup = resizeWinCleanup.current
      resizeWinCleanup.current = null
      cleanup?.()
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
  }, [])

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
    e.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }, [])

  const onDragLeave = useCallback(() => setDropActive(false), [])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDropActive(false)
      const store = useCanvasStore.getState()
      const local = getLocalPoint(e)
      const world = screenToWorld(local.x, local.y, store.viewport)
      const files = [...e.dataTransfer.files]
      // Under Tauri, files is usually empty — native handler above covers that path
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
        {(() => {
          const groups = new Map<string, typeof items>()
          for (const it of items) {
            if (!it.stackGroupId || !it.stacked) continue
            const list = groups.get(it.stackGroupId) || []
            list.push(it)
            groups.set(it.stackGroupId, list)
          }
          return [...groups.entries()].map(([gid, members]) => {
            const b = stackGroupBounds(members, 20)
            if (!b) return null
            const selected = members.some((m) => selectedSet.has(m.id))
            // Folder sits under members but catches clicks on chrome/padding
            const z = Math.min(...members.map((m) => m.zIndex)) - 1
            const proxy = members[0]
            return (
              <div
                key={`folder-${gid}`}
                className={`stack-folder ${selected ? 'is-selected' : ''}`}
                style={{
                  transform: `translate(${b.x}px, ${b.y}px)`,
                  width: b.width,
                  height: b.height,
                  zIndex: z,
                }}
                onPointerDown={(e) => {
                  if (!proxy) return
                  // Treat folder chrome as selecting the whole stack (frozen unit)
                  onItemPointerDown(e, proxy)
                }}
              >
                <div className="stack-folder-tab" />
                <div className="stack-folder-body" />
                <span className="stack-folder-label">{members.length}</span>
              </div>
            )
          })
        })()}
        {sortedItems.map((item) => (
          <CanvasItemView
            key={item.id}
            item={item}
            selected={selectedSet.has(item.id)}
            onPointerDown={onItemPointerDown}
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

      {dropActive && <div className="drop-overlay">Drop media to place</div>}
    </div>
  )
}
