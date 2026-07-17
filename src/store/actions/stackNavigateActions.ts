import { ROOT_CONTAINER_ID } from '../../types/canvas'
import { resetStackAnimProgress } from '../../utils/stackAnimProgress'
import { withViewport } from '../../utils/stacks'
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'
import { runStackExitNavigation } from './stackExitNavigation'

export type StackNavigateActionKey = 'navigateToContainer'

export function createStackNavigateActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, StackNavigateActionKey> {
  return {
  navigateToContainer: (containerId, options) => {
    const s = get()
    if (containerId === s.currentContainerId) return
    // Silent folds may run while animating is still true at settle end —
    // only block user-driven animated nav when another anim is in flight.
    const wantAnim = options?.animate !== false
    if (wantAnim && s.animating) return

    const leavingId = s.currentContainerId
    const leavingStack =
      leavingId !== ROOT_CONTAINER_ID
        ? s.stacks.find((st) => st.id === leavingId)
        : null

    // Save viewport on current stack / home
    if (leavingId === ROOT_CONTAINER_ID) {
      set({ homeViewport: { ...s.viewport } })
    } else if (leavingStack) {
      set({
        stacks: s.stacks.map((st) =>
          st.id === leavingId ? withViewport(st, s.viewport) : st,
        ),
      })
    }

    if (leavingStack) {
      runStackExitNavigation(set, get, {
        leavingStack,
        containerId,
        wantAnim,
      })
      return
    }

    if (containerId === ROOT_CONTAINER_ID) {
      resetStackAnimProgress()
      set({
        currentContainerId: ROOT_CONTAINER_ID,
        selectedIds: [],
        selectedStackIds: [],
        editingId: null,
        editingStackGroupId: null,
        stackEnterAnim: null,
        viewport: { ...get().homeViewport },
      })
      return
    }

    const target = get().stacks.find((st) => st.id === containerId)
    if (!target) return
    get().enterStack(containerId)
  },

  }
}

