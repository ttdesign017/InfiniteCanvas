import { ROOT_CONTAINER_ID } from '../../types/canvas'
import { revokeUnreferencedBlobs } from '../../utils/blobUrls'
import { resetStackAnimProgress } from '../../utils/stackAnimProgress'
import { cloneItems, cloneStacks, blobUrlsStillReachable } from '../actionHelpers'
import type { HistoryEntry } from '../types'
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'

export type HistoryActionKey =
  | 'pushHistory'
  | 'markDirty'
  | 'clearDirty'
  | 'undo'
  | 'redo'

export function createHistoryActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, HistoryActionKey> {
  return {

  pushHistory: () => {
    const { items, stacks, nextZ, currentContainerId, history, future } = get()
    const entry: HistoryEntry = {
      items: cloneItems(items),
      stacks: cloneStacks(stacks),
      nextZ,
      currentContainerId,
    }
    // Cap ~50 entries; dropping oldest / clearing redo may orphan blob URLs
    const nextHistory = [...history.slice(-49), entry]
    const droppedHistory =
      history.length > 49 ? history.slice(0, history.length - 49) : []
    const droppedFuture = future
    set({
      history: nextHistory,
      future: [],
      dirty: true,
    })
    if (droppedHistory.length > 0 || droppedFuture.length > 0) {
      const live = get()
      const keep = blobUrlsStillReachable(live.items, live.history, live.future)
      for (const d of droppedHistory) revokeUnreferencedBlobs(d.items, keep)
      for (const d of droppedFuture) revokeUnreferencedBlobs(d.items, keep)
    }
  },


  markDirty: () => set({ dirty: true }),

  clearDirty: () => set({ dirty: false }),


  undo: () => {
    const { history, items, stacks, nextZ, currentContainerId, future } =
      get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    resetStackAnimProgress()
    set({
      history: history.slice(0, -1),
      future: [
        ...future,
        {
          items: cloneItems(items),
          stacks: cloneStacks(stacks),
          nextZ,
          currentContainerId,
        },
      ],
      items: prev.items,
      stacks: prev.stacks ?? [],
      nextZ: prev.nextZ,
      currentContainerId: prev.currentContainerId ?? ROOT_CONTAINER_ID,
      selectedIds: [],
      selectedStackIds: [],
      editingId: null,
      editingStackGroupId: null,
      animating: false,
      stackEnterAnim: null,
      pendingNavigation: null,
      dirty: true,
    })
  },


  redo: () => {
    const { future, items, stacks, nextZ, currentContainerId, history } =
      get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    resetStackAnimProgress()
    set({
      future: future.slice(0, -1),
      history: [
        ...history,
        {
          items: cloneItems(items),
          stacks: cloneStacks(stacks),
          nextZ,
          currentContainerId,
        },
      ],
      items: next.items,
      stacks: next.stacks ?? [],
      nextZ: next.nextZ,
      currentContainerId: next.currentContainerId ?? ROOT_CONTAINER_ID,
      selectedIds: [],
      selectedStackIds: [],
      editingId: null,
      editingStackGroupId: null,
      animating: false,
      stackEnterAnim: null,
      pendingNavigation: null,
      dirty: true,
    })
  },
  }
}
