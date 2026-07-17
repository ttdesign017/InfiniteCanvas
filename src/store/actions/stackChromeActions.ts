import type { CanvasItem } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import {
  itemsInContainer,
  stackDisplayName,
  stackPath,
  stacksInContainer,
} from '../../utils/stacks'
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'

export type StackChromeActionKey =
  | 'commitStackName'
  | 'getVisibleItems'
  | 'getVisibleStacks'
  | 'getBreadcrumb'

export function createStackChromeActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, StackChromeActionKey> {
  return {
    commitStackName: (groupId, name) => {
      const trimmed = name.trim()
      const stack = get().stacks.find((s) => s.id === groupId)
      if (stack) {
        const prev = (stack.name || '').trim()
        if (prev === trimmed) {
          set({ editingStackGroupId: null })
          return
        }
        get().pushHistory()
        set((s) => ({
          editingStackGroupId: null,
          dirty: true,
          stacks: s.stacks.map((st) =>
            st.id === groupId ? { ...st, name: trimmed } : st,
          ),
        }))
        return
      }
      // Legacy: name written onto stacked members
      const members = get().items.filter(
        (i) => i.stacked && i.stackGroupId === groupId,
      )
      if (members.length === 0) {
        set({ editingStackGroupId: null })
        return
      }
      const prev = (members[0].stackName || '').trim()
      if (prev === trimmed) {
        set({ editingStackGroupId: null })
        return
      }
      get().pushHistory()
      set((s) => ({
        editingStackGroupId: null,
        dirty: true,
        items: s.items.map((item) => {
          if (!(item.stacked && item.stackGroupId === groupId)) return item
          if (trimmed) return { ...item, stackName: trimmed }
          const { stackName: _n, ...rest } = item
          return rest as CanvasItem
        }),
      }))
    },

    getVisibleItems: () => {
      const s = get()
      return itemsInContainer(s.items, s.currentContainerId)
    },

    getVisibleStacks: () => {
      const s = get()
      return stacksInContainer(s.stacks, s.currentContainerId)
    },

    getBreadcrumb: () => {
      const s = get()
      const path = stackPath(s.stacks, s.currentContainerId)
      return [
        { id: ROOT_CONTAINER_ID, name: 'Home' },
        ...path.map((st) => ({
          id: st.id,
          name: stackDisplayName(st, 'Untitled'),
        })),
      ]
    },
  }
}
