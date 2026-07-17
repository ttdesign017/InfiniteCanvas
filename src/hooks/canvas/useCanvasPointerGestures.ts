import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useCanvasStore } from '../../store/useCanvasStore'
import type { CanvasItem } from '../../types/canvas'
import { expandStackSelection, hitStackGroupAt, placeItemsTight, screenToWorld, stackCollapsedSnapBounds } from '../../utils/layout'
import { collectItemsInStackTree, containerOf } from '../../utils/stacks'
import { createMediaFromFile, createMediaFromPath } from '../../utils/media'
import { importDropAt } from '../../utils/dropImport'
import { computeResize, isEdgeResizeType } from '../../utils/resize'
import { computeSnapDelta, guidesEqual, snapResizeRect, type SnapGuide } from '../../utils/snap'
import { isDesktop, onNativeFileDrop, openExternal } from '../../utils/desktop'
import { clearTextScalePreview, getTextScalePreview, originFromHandle, scaledBoxFromPreview, setTextScalePreview } from '../../utils/textScalePreview'
import { applyGroupScale, computeSelectionBounds, groupFactorFromSnappedBox, groupScaleFactor, groupScaledBounds, isGroupScalableType, type GroupBodyOrigin, type GroupScaleHandle } from '../../utils/selectionBounds'
import { marqueeHitsRotatedItem } from '../../utils/geometry'
import { DRAG_THRESHOLD_PX, type DragMode } from './dragTypes'
import { captureJointMoveSelection } from './jointSelection'
import { CROP_ROTATED_HINT, resolveCropTargets } from './cropTargets'
import { blurChrome, dismissStackNameEdit, isInteractionLocked } from './canvasUiHelpers'

export type CanvasPointerGestureApi = {
  onGroupScalePointerDown: (
    e: React.PointerEvent,
    handle: GroupScaleHandle,
  ) => void
  onResizePointerDown: (
    e: React.PointerEvent,
    item: CanvasItem,
    handle: string,
  ) => void
  onItemPointerDown: (e: React.PointerEvent, item: CanvasItem) => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragEnter: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export function useCanvasPointerGestures(deps: {
  surfaceRef: RefObject<HTMLDivElement | null>
  dragRef: React.MutableRefObject<DragMode>
  eraseHistoryPushed: React.MutableRefObject<boolean>
  lastItemClickRef: React.MutableRefObject<{
    id: string
    t: number
    x: number
    y: number
  } | null>
  stackDropTargetRef: React.MutableRefObject<string | null>
  setStackDropTarget: (gid: string | null) => void
  setMarquee: Dispatch<
    SetStateAction<{ x: number; y: number; w: number; h: number } | null>
  >
  setCropOverlay: Dispatch<
    SetStateAction<{ x: number; y: number; w: number; h: number } | null>
  >
  setDropActive: Dispatch<SetStateAction<boolean>>
  setSnapGuides: Dispatch<SetStateAction<SnapGuide[]>>
  scheduleDragWrite: (fn: () => void) => void
  flushDragWrite: () => void
  getLocalPoint: (e: { clientX: number; clientY: number }) => {
    x: number
    y: number
  }
  effectiveTool: string
  isGroupSelect: boolean
  selectedSet: Set<string>
  selectedStackSet: Set<string>
  visibleItems: CanvasItem[]
  currentContainerId: string
}): CanvasPointerGestureApi {
  const {
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
  } = deps

  void selectedSet
  void selectedStackSet
  void visibleItems
  void currentContainerId
  void effectiveTool
  void isGroupSelect
  void eraseHistoryPushed
  void lastItemClickRef
  void stackDropTargetRef
  void setStackDropTarget
  void onNativeFileDrop

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
      if (live.type === 'scribble' || live.type === 'embed' || live.type === 'audio') return
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
    [getLocalPoint],
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
          patch: Partial<import('../../types/canvas').StackRecord>
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



  return {
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
  }
}
