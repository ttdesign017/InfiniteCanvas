import { allContentBounds } from '../../utils/layout'
import {
  resetStackAnimProgress,
  seedStackAnimProgress,
} from '../../utils/stackAnimProgress'
import { itemsInContainer, stacksInContainer } from '../../utils/stacks'
import { DEFAULT_VIEWPORT } from '../canvasStoreTypes'
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'

export type ViewportActionKey =
  | 'setTool'
  | 'setEditingId'
  | 'setEditingStackGroupId'
  | 'setSaving'
  | 'flashSaveNotice'
  | 'clearSaveNotice'
  | 'setImmersiveMode'
  | 'toggleImmersiveMode'
  | 'setStackEnterAnim'
  | 'setSnapEnabled'
  | 'toggleSnap'
  | 'setViewport'
  | 'panBy'
  | 'zoomAt'
  | 'resetView'
  | 'setSpaceHeld'
  | 'setCHeld'
  | 'setIsPanning'
  | 'setScribbleStyle'
  | 'setEraseWidth'

export function createViewportActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, ViewportActionKey> {
  return {

  setTool: (tool) => {
    const s = get()
    // Leaving the pen tool closes the current scribble layer session
    const leavingScribble = s.tool === 'scribble' && tool !== 'scribble'
    const activeId = s.activeScribbleId
    set({
      tool,
      editingId: null,
      editingStackGroupId: null,
      ...(leavingScribble
        ? {
            activeScribbleId: null,
            // Drop the layer selection so its raise-z chrome does not block picks
            selectedIds: activeId
              ? s.selectedIds.filter((id) => id !== activeId)
              : s.selectedIds,
            selectedStackIds: [],
          }
        : {}),
    })
  },

  setEditingId: (id) => set({ editingId: id, editingStackGroupId: null }),

  setEditingStackGroupId: (groupId) =>
    set({ editingStackGroupId: groupId, editingId: null }),

  setSaving: (saving) => set({ isSaving: saving }),

  flashSaveNotice: (message = 'Saved') =>
    set((s) => ({
      isSaving: false,
      saveNotice: message,
      saveNoticeSeq: s.saveNoticeSeq + 1,
    })),

  clearSaveNotice: () => set({ saveNotice: null, isSaving: false }),

  setImmersiveMode: (on) => set({ immersiveMode: on }),

  toggleImmersiveMode: () => set((s) => ({ immersiveMode: !s.immersiveMode })),

  setStackEnterAnim: (anim) => {
    if (anim) {
      seedStackAnimProgress({
        t: anim.t,
        settle: anim.settle ?? 0,
        peerReveal: anim.peerReveal ?? (anim.mode === 'enter' ? 1 : 0),
        nestedChromeOpacity: anim.nestedChromeOpacity ?? 1,
      })
    } else {
      resetStackAnimProgress()
    }
    set({ stackEnterAnim: anim })
  },

  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),

  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),


  setViewport: (viewport) =>
    set((s) => ({ viewport: { ...s.viewport, ...viewport } })),


  panBy: (dx, dy) =>
    set((s) => ({
      viewport: { ...s.viewport, x: s.viewport.x + dx, y: s.viewport.y + dy },
    })),


  zoomAt: (screenX, screenY, factor) => {
    const { viewport } = get()
    const nextZoom = Math.min(8, Math.max(0.08, viewport.zoom * factor))
    const wx = (screenX - viewport.x) / viewport.zoom
    const wy = (screenY - viewport.y) / viewport.zoom
    set({
      viewport: {
        zoom: nextZoom,
        x: screenX - wx * nextZoom,
        y: screenY - wy * nextZoom,
      },
    })
  },


  resetView: () => {
    const s = get()
    const items = itemsInContainer(s.items, s.currentContainerId)
    const folderStacks = stacksInContainer(s.stacks, s.currentContainerId)
    if (items.length === 0 && folderStacks.length === 0) {
      set({ viewport: { ...DEFAULT_VIEWPORT } })
      return
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const itemBounds = allContentBounds(items)
    if (itemBounds) {
      minX = Math.min(minX, itemBounds.x)
      minY = Math.min(minY, itemBounds.y)
      maxX = Math.max(maxX, itemBounds.x + itemBounds.width)
      maxY = Math.max(maxY, itemBounds.y + itemBounds.height)
    }
    for (const st of folderStacks) {
      minX = Math.min(minX, st.x)
      minY = Math.min(minY, st.y)
      maxX = Math.max(maxX, st.x + st.width)
      maxY = Math.max(maxY, st.y + st.height)
    }
    if (!Number.isFinite(minX)) {
      set({ viewport: { ...DEFAULT_VIEWPORT } })
      return
    }
    const bounds = {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }

    const pad = 96
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900

    const zoom = Math.min(
      4,
      Math.max(
        0.08,
        Math.min((vw - pad * 2) / bounds.width, (vh - pad * 2) / bounds.height),
      ),
    )
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    set({
      viewport: {
        zoom,
        x: vw / 2 - cx * zoom,
        y: vh / 2 - cy * zoom,
      },
    })
  },


  setSpaceHeld: (held) => set({ spaceHeld: held }),

  setCHeld: (held) => set({ cHeld: held }),

  setIsPanning: (panning) => set({ isPanning: panning }),


  setScribbleStyle: (color, width) =>
    set((s) => ({
      scribbleColor: color ?? s.scribbleColor,
      scribbleWidth: width ?? s.scribbleWidth,
    })),


  setEraseWidth: (width) => set({ eraseWidth: width }),
  }
}
