/**
 * nestInto handoff after Ctrl+G fan animation completes.
 * Keeps animateToLayout focused on interpolation; this owns reparent + free poses.
 */

import { stackGroupBounds, STACK_FOLDER_PAD } from '../../utils/layout'
import {
  buildNestFreePoses,
  type ItemPose,
} from '../../utils/nestFreeLayout'
import {
  asFreeOnContainer,
  collectItemsInStackTree,
  createStackRecord,
} from '../../utils/stacks'
import {
  ensureStackFanComposite,
  stackFanNeedsLiveText,
} from '../../utils/stackFanComposite'
import { reflowContainerSurfaceZ } from '../../utils/zOrder'
import type { GetState, SetState } from '../canvasStoreTypes'

export type NestIntoFinalizeArgs = {
  groupId: string
  parentId: string
  targetIds: ReadonlySet<string>
  /** Pre-stack free poses captured at animateToLayout start */
  startMap: ReadonlyMap<string, ItemPose>
}

/**
 * Fan anim done on parent -> reparent into enterable stack.
 * Parent keeps fan poses in stackPreview; inner free layout from startMap.
 * Does not leave stacked/stackGroupId on members (would redraw folder chrome inside).
 */
export function finalizeNestIntoStack(
  get: GetState,
  set: SetState,
  args: NestIntoFinalizeArgs,
): void {
  const { groupId, parentId, targetIds, startMap } = args
  const live = get()
  const members = live.items
    .filter((i) => targetIds.has(i.id))
    .sort((a, b) => a.zIndex - b.zIndex)

  const folderBounds = stackGroupBounds(members)
  const folder = folderBounds ?? {
    x: members[0]?.x ?? 0,
    y: members[0]?.y ?? 0,
    width: 200,
    height: 200,
  }
  const zMin =
    members.length > 0
      ? Math.min(...members.map((m) => m.zIndex))
      : live.nextZ

  const stack = createStackRecord(
    parentId,
    folder,
    zMin - 1,
    '',
    groupId,
  )

  const freePoses = buildNestFreePoses(
    members.map((m) => m.id),
    startMap,
    STACK_FOLDER_PAD,
  )

  set((s) => ({
    animating: false,
    dirty: true,
    stacks: s.stacks.some((st) => st.id === groupId)
      ? s.stacks.map((st) =>
          st.id === groupId
            ? {
                ...st,
                x: folder.x,
                y: folder.y,
                width: folder.width,
                height: folder.height,
                zIndex: zMin - 1,
              }
            : st,
        )
      : [...s.stacks, stack],
    items: s.items.map((item) => {
      if (!targetIds.has(item.id)) return item
      const free = freePoses.get(item.id)
      // Missing pre-stack pose: skip reparent rather than invent fan-as-free coords
      if (!free) return item
      return asFreeOnContainer(
        item,
        groupId,
        free,
        {
          // Fan pose left on the parent canvas
          x: item.x,
          y: item.y,
          rotation: item.rotation ?? 0,
        },
      )
    }),
    selectedIds: [],
    selectedStackIds: [groupId],
    editingStackGroupId: groupId,
    editingId: null,
  }))

  // Contiguous z for the new stack unit among siblings on parent
  const afterNest = get()
  const healed = reflowContainerSurfaceZ(
    afterNest.items,
    afterNest.stacks,
    parentId,
    { frontStackIds: [groupId] },
  )
  set({
    nextZ: Math.max(afterNest.nextZ, healed.nextZ),
    items: afterNest.items.map((item) =>
      healed.itemZMap.has(item.id)
        ? { ...item, zIndex: healed.itemZMap.get(item.id)! }
        : item,
    ),
    stacks: afterNest.stacks.map((st) =>
      healed.stackZMap.has(st.id)
        ? { ...st, zIndex: healed.stackZMap.get(st.id)! }
        : st,
    ),
  })

  // Media-only collapsed fan bitmap before React paints the new folder
  if (typeof document !== 'undefined') {
    const composed = get()
    const composedStack = composed.stacks.find((c) => c.id === groupId)
    const fanItems = composedStack
      ? collectItemsInStackTree(
          composed.items,
          composed.stacks,
          composedStack.id,
        )
      : []
    if (composedStack && !stackFanNeedsLiveText(fanItems)) {
      void ensureStackFanComposite(
        composedStack,
        composed.items,
        composed.stacks,
      ).catch(() => null)
    }
  }
}
