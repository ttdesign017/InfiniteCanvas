import type { CanvasItem, StackRecord } from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import {
  collectDescendantStackIds,
  collectItemsInStackTree,
  containerOf,
  stacksInContainer,
} from './stacks'

/**
 * Raise selected items as atomic bodies (free item or whole stack).
 * Stacks reserve one z slot under their members for folder chrome so
 * free items cannot sit between the folder and stack content.
 *
 * Legacy same-canvas stacks (`stacked` + `stackGroupId`) are still supported.
 * Nested enterable stacks use `StackRecord` + member `containerId` — use
 * `raiseSelectionZ` for those.
 */
export function buildRaiseZMap(
  items: CanvasItem[],
  selectedIds: string[],
  startZ: number,
  options?: { promoteFreeId?: string | null },
): { zMap: Map<string, number>; nextZ: number } {
  const byId = new Map(items.map((i) => [i.id, i]))
  const selected = new Set(selectedIds)

  type Body = {
    key: string
    minZ: number
    memberIds: string[]
    isStack: boolean
  }

  const bodies: Body[] = []
  const seenStack = new Set<string>()

  for (const id of selectedIds) {
    if (!selected.has(id)) continue
    const it = byId.get(id)
    if (!it) continue

    if (it.stacked && it.stackGroupId) {
      const gid = it.stackGroupId
      if (seenStack.has(gid)) continue
      seenStack.add(gid)
      const members = items
        .filter((i) => i.stacked && i.stackGroupId === gid)
        .sort((a, b) => a.zIndex - b.zIndex)
      if (members.length === 0) continue
      bodies.push({
        key: `stack:${gid}`,
        minZ: members[0].zIndex,
        memberIds: members.map((m) => m.id),
        isStack: true,
      })
    } else {
      bodies.push({
        key: `free:${id}`,
        minZ: it.zIndex,
        memberIds: [id],
        isStack: false,
      })
    }
  }

  bodies.sort((a, b) => a.minZ - b.minZ || a.key.localeCompare(b.key))

  const promote = options?.promoteFreeId
  if (promote) {
    const idx = bodies.findIndex(
      (b) => !b.isStack && b.memberIds[0] === promote,
    )
    if (idx >= 0) {
      const [body] = bodies.splice(idx, 1)
      bodies.push(body)
    }
  }

  let z = startZ
  const zMap = new Map<string, number>()
  for (const body of bodies) {
    // Folder chrome is rendered at min(member z) - 1 — reserve that slot.
    if (body.isStack) z += 1
    for (const id of body.memberIds) {
      zMap.set(id, z++)
    }
  }

  return { zMap, nextZ: z }
}

/** Min z of a nested stack unit (folder + whole descendant tree). */
export function nestedStackUnitMinZ(
  stack: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
): number {
  const leaves = collectItemsInStackTree(items, stacks, stack.id)
  if (leaves.length === 0) return stack.zIndex
  return Math.min(stack.zIndex, ...leaves.map((m) => m.zIndex))
}

/** Max z of a nested stack unit — matches visual top of its fan cards. */
export function nestedStackUnitMaxZ(
  stack: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
): number {
  const leaves = collectItemsInStackTree(items, stacks, stack.id)
  if (leaves.length === 0) return stack.zIndex
  return Math.max(stack.zIndex, ...leaves.map((m) => m.zIndex))
}

/**
 * Contiguous z for one enterable stack tree.
 * Folder slot first, then surface units of that canvas (free items + child
 * stacks) in back→front order. Child stacks recurse so nested fan cards stay
 * above their chrome and never interleave with free siblings of the parent.
 *
 * `surfaceOrder` (optional): explicit back→front unit ids for the root canvas
 * only (`item:<id>` / `stack:<id>`). Used to freeze exit-time fan order.
 * Deeper levels always sort by current zIndex.
 */
export function allocateNestedStackTreeZ(
  items: CanvasItem[],
  stacks: StackRecord[],
  rootStackId: string,
  startZ: number,
  surfaceOrder?: string[],
): {
  itemZMap: Map<string, number>
  stackZMap: Map<string, number>
  nextZ: number
} {
  const itemZMap = new Map<string, number>()
  const stackZMap = new Map<string, number>()
  let z = startZ

  const allocate = (stackId: string, orderKeys?: string[]) => {
    stackZMap.set(stackId, z++)

    const freeItems = items
      .filter((i) => containerOf(i) === stackId)
      .sort(
        (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
      )
    const childStacks = stacksInContainer(stacks, stackId)

    type Unit = { key: string; kind: 'item' | 'stack'; id: string; minZ: number }
    const units: Unit[] = []
    for (const m of freeItems) {
      units.push({
        key: `item:${m.id}`,
        kind: 'item',
        id: m.id,
        minZ: m.zIndex,
      })
    }
    for (const cs of childStacks) {
      units.push({
        key: `stack:${cs.id}`,
        kind: 'stack',
        id: cs.id,
        minZ: nestedStackUnitMinZ(cs, items, stacks),
      })
    }

    if (orderKeys && orderKeys.length > 0) {
      const byKey = new Map(units.map((u) => [u.key, u]))
      const ordered: Unit[] = []
      for (const k of orderKeys) {
        const u = byKey.get(k)
        if (u) {
          ordered.push(u)
          byKey.delete(k)
        }
      }
      // Any units missing from orderKeys keep relative minZ order at end
      const rest = [...byKey.values()].sort(
        (a, b) => a.minZ - b.minZ || a.key.localeCompare(b.key),
      )
      units.length = 0
      units.push(...ordered, ...rest)
    } else {
      units.sort((a, b) => a.minZ - b.minZ || a.key.localeCompare(b.key))
    }

    for (const u of units) {
      if (u.kind === 'item') {
        itemZMap.set(u.id, z++)
      } else {
        // Child stacks: internal order by current z (not parent surfaceOrder)
        allocate(u.id)
      }
    }
  }

  allocate(rootStackId, surfaceOrder)
  return { itemZMap, stackZMap, nextZ: z }
}

/**
 * Raise free items + nested stack folders as atomic bodies on the current
 * canvas. Nested stack: entire descendant tree is one contiguous z block
 * (folder under members; child stacks nested as atomic sub-units) so fan
 * previews never fall under free siblings after select/raise.
 */
export function raiseSelectionZ(
  items: CanvasItem[],
  stacks: StackRecord[],
  selectedItemIds: string[],
  selectedStackIds: string[],
  startZ: number,
  options?: { promoteFreeId?: string | null },
): {
  itemZMap: Map<string, number>
  stackZMap: Map<string, number>
  nextZ: number
} {
  const byId = new Map(items.map((i) => [i.id, i]))
  const stackById = new Map(stacks.map((s) => [s.id, s]))
  const selectedStackSet = new Set(
    selectedStackIds.filter((id) => stackById.has(id)),
  )

  // Only raise root-most selected stacks (skip nested under another selected stack)
  const rootStackIds = [...selectedStackSet].filter((sid) => {
    let parent = stackById.get(sid)?.parentId
    const guard = new Set<string>()
    while (parent && parent !== ROOT_CONTAINER_ID && !guard.has(parent)) {
      guard.add(parent)
      if (selectedStackSet.has(parent)) return false
      parent = stackById.get(parent)?.parentId
    }
    return true
  })

  type Body = {
    key: string
    minZ: number
    kind: 'free' | 'legacy-stack' | 'nested-stack'
    memberIds: string[]
    stackId?: string
  }

  const bodies: Body[] = []
  const seenLegacy = new Set<string>()
  const claimedItems = new Set<string>()
  const claimedStacks = new Set<string>()

  for (const sid of rootStackIds) {
    const st = stackById.get(sid)
    if (!st) continue
    const treeIds = collectDescendantStackIds(stacks, sid)
    for (const id of treeIds) claimedStacks.add(id)
    const treeItems = collectItemsInStackTree(items, stacks, sid)
    for (const m of treeItems) claimedItems.add(m.id)
    bodies.push({
      key: `nested:${sid}`,
      minZ: nestedStackUnitMinZ(st, items, stacks),
      kind: 'nested-stack',
      memberIds: treeItems.map((m) => m.id),
      stackId: sid,
    })
  }

  for (const id of selectedItemIds) {
    if (claimedItems.has(id)) continue
    const it = byId.get(id)
    if (!it) continue

    // Item lives inside a claimed nested stack tree
    if (claimedStacks.has(containerOf(it))) continue

    if (it.stacked && it.stackGroupId) {
      const gid = it.stackGroupId
      if (seenLegacy.has(gid)) continue
      seenLegacy.add(gid)
      const members = items
        .filter((i) => i.stacked && i.stackGroupId === gid)
        .sort((a, b) => a.zIndex - b.zIndex)
      if (members.length === 0) continue
      for (const m of members) claimedItems.add(m.id)
      bodies.push({
        key: `legacy:${gid}`,
        minZ: members[0].zIndex,
        kind: 'legacy-stack',
        memberIds: members.map((m) => m.id),
      })
    } else {
      bodies.push({
        key: `free:${id}`,
        minZ: it.zIndex,
        kind: 'free',
        memberIds: [id],
      })
    }
  }

  bodies.sort((a, b) => a.minZ - b.minZ || a.key.localeCompare(b.key))

  const promote = options?.promoteFreeId
  if (promote) {
    const idx = bodies.findIndex(
      (b) => b.kind === 'free' && b.memberIds[0] === promote,
    )
    if (idx >= 0) {
      const [body] = bodies.splice(idx, 1)
      bodies.push(body)
    }
  }

  let z = startZ
  const itemZMap = new Map<string, number>()
  const stackZMap = new Map<string, number>()

  for (const body of bodies) {
    if (body.kind === 'nested-stack' && body.stackId) {
      const sub = allocateNestedStackTreeZ(
        items,
        stacks,
        body.stackId,
        z,
      )
      for (const [id, vz] of sub.itemZMap) itemZMap.set(id, vz)
      for (const [id, vz] of sub.stackZMap) stackZMap.set(id, vz)
      z = sub.nextZ
    } else if (body.kind === 'legacy-stack') {
      z += 1 // reserve folder slot (rendered as min(member)-1)
      for (const id of body.memberIds) {
        itemZMap.set(id, z++)
      }
    } else {
      for (const id of body.memberIds) {
        itemZMap.set(id, z++)
      }
    }
  }

  return { itemZMap, stackZMap, nextZ: z }
}

/**
 * Contiguous z block for a stack (folder slot + members in given order).
 * `memberIds` order is back → front (first = bottom of stack).
 */
export function allocateStackZBlock(
  memberIds: string[],
  startZ: number,
): { zMap: Map<string, number>; nextZ: number } {
  let z = startZ + 1 // reserve folder
  const zMap = new Map<string, number>()
  for (const id of memberIds) {
    zMap.set(id, z++)
  }
  return { zMap, nextZ: z }
}

/**
 * Freeze z-order of a stack's surface to the given back→front unit order
 * (e.g. exit fan order). Child nested stacks keep internal relative order.
 * Allocates a contiguous block starting at `baseZ` (usually the stack's
 * current folder z so parent-sibling ranking is preserved).
 */
export function freezeStackSurfaceZ(
  items: CanvasItem[],
  stacks: StackRecord[],
  stackId: string,
  /** Back→front surface units: free item ids and nested stack ids mixed */
  surfaceBackToFront: Array<{ kind: 'item' | 'stack'; id: string }>,
  baseZ: number,
): {
  itemZMap: Map<string, number>
  stackZMap: Map<string, number>
  nextZ: number
} {
  const orderKeys = surfaceBackToFront.map((u) =>
    u.kind === 'item' ? `item:${u.id}` : `stack:${u.id}`,
  )
  return allocateNestedStackTreeZ(
    items,
    stacks,
    stackId,
    baseZ,
    orderKeys,
  )
}
