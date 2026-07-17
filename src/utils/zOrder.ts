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
 * Paint z for folder chrome.
 *
 * After a proper contiguous allocation, `stack.zIndex` is the reserved folder
 * slot under fan cards. Legacy/broken data may leave stack.zIndex above some
 * leaves — then fall back to min(leaves)-1 so chrome still sits under its fan.
 */
export function stackFolderPaintZ(
  stack: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
): number {
  const leaves = collectItemsInStackTree(items, stacks, stack.id)
  if (leaves.length === 0) return stack.zIndex
  const minLeaf = Math.min(...leaves.map((m) => m.zIndex))
  if (stack.zIndex <= minLeaf) return stack.zIndex
  return minLeaf - 1
}

/** Count badge sits just above the stack unit. */
export function stackCountPaintZ(
  stack: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
): number {
  return nestedStackUnitMaxZ(stack, items, stacks) + 1
}

/**
 * Ids that belong to a stack unit's z block (folder stack tree + all leaf items).
 */
export function stackUnitMemberIds(
  stackId: string,
  items: CanvasItem[],
  stacks: StackRecord[],
): { stackIds: Set<string>; itemIds: Set<string> } {
  const stackIds = collectDescendantStackIds(stacks, stackId)
  const itemIds = new Set(
    collectItemsInStackTree(items, stacks, stackId).map((m) => m.id),
  )
  return { stackIds, itemIds }
}

export type StackInterleaveHit = {
  stackId: string
  /** Foreign surface body that paints inside this stack's [lo, hi] range */
  foreign:
    | { kind: 'item'; id: string; zIndex: number }
    | { kind: 'stack'; id: string; zIndex: number }
  range: { lo: number; hi: number }
}

/**
 * Detect folder/fan interleaving on one canvas: any free item or *other* stack
 * unit whose z sits inside this stack's [unitMin, unitMax] range.
 *
 * This is the bug class: stack A folder under z=4, stack B fan at z=6, stack A
 * fan at z=10 → B is painted between A's folder and A's fan.
 */
export function findStackUnitInterleaving(
  items: CanvasItem[],
  stacks: StackRecord[],
  containerId: string = ROOT_CONTAINER_ID,
): StackInterleaveHit[] {
  const surfaceStacks = stacksInContainer(stacks, containerId)
  const hits: StackInterleaveHit[] = []

  for (const st of surfaceStacks) {
    const lo = nestedStackUnitMinZ(st, items, stacks)
    const hi = nestedStackUnitMaxZ(st, items, stacks)
    const mine = stackUnitMemberIds(st.id, items, stacks)

    for (const it of items) {
      if (mine.itemIds.has(it.id)) continue
      // Only surface free items on this canvas can slip between folder and fan
      if (containerOf(it) !== containerId) continue
      if (it.stacked) continue
      if (it.zIndex >= lo && it.zIndex <= hi) {
        hits.push({
          stackId: st.id,
          foreign: { kind: 'item', id: it.id, zIndex: it.zIndex },
          range: { lo, hi },
        })
      }
    }

    for (const other of surfaceStacks) {
      if (other.id === st.id) continue
      if (mine.stackIds.has(other.id)) continue
      const oLo = nestedStackUnitMinZ(other, items, stacks)
      const oHi = nestedStackUnitMaxZ(other, items, stacks)
      // Overlapping ranges ⇒ one unit's chrome/fan can sit inside the other
      const overlaps = oLo <= hi && oHi >= lo
      if (!overlaps) continue
      // Report if other's any edge sits strictly inside ours or ranges properly cross
      if (
        (oLo >= lo && oLo <= hi) ||
        (oHi >= lo && oHi <= hi) ||
        (oLo <= lo && oHi >= hi)
      ) {
        hits.push({
          stackId: st.id,
          foreign: { kind: 'stack', id: other.id, zIndex: oLo },
          range: { lo, hi },
        })
      }
    }
  }

  return hits
}

export function stackUnitsAreAtomicOnContainer(
  items: CanvasItem[],
  stacks: StackRecord[],
  containerId: string = ROOT_CONTAINER_ID,
): boolean {
  return findStackUnitInterleaving(items, stacks, containerId).length === 0
}

/**
 * Reflow every surface body on `containerId` into contiguous z blocks.
 *
 * Order (back → front): unselected free items & stacks (by current minZ),
 * then front/selected bodies (by current minZ, optional promote free last).
 * Each nested stack is one block: folder slot, then free members / child stacks
 * recursively — so folder + fan never admit a sibling free item or stack.
 */
export function reflowContainerSurfaceZ(
  items: CanvasItem[],
  stacks: StackRecord[],
  containerId: string,
  options?: {
    frontItemIds?: string[]
    frontStackIds?: string[]
    /** When true, "front" ids are painted under everyone else (send to back). */
    pinToBack?: boolean
    promoteFreeId?: string | null
    startZ?: number
  },
): {
  itemZMap: Map<string, number>
  stackZMap: Map<string, number>
  nextZ: number
} {
  const byId = new Map(items.map((i) => [i.id, i]))
  const stackById = new Map(stacks.map((s) => [s.id, s]))
  const frontItemSet = new Set(options?.frontItemIds ?? [])
  const frontStackSet = new Set(
    (options?.frontStackIds ?? []).filter((id) => stackById.has(id)),
  )
  const pinToBack = options?.pinToBack === true

  // Root-most front stacks only
  const frontRootStacks = [...frontStackSet].filter((sid) => {
    let parent = stackById.get(sid)?.parentId
    const guard = new Set<string>()
    while (parent && parent !== ROOT_CONTAINER_ID && !guard.has(parent)) {
      guard.add(parent)
      if (frontStackSet.has(parent)) return false
      parent = stackById.get(parent)?.parentId
    }
    return true
  })

  const claimedByFrontStacks = new Set<string>()
  for (const sid of frontRootStacks) {
    for (const id of collectDescendantStackIds(stacks, sid)) {
      claimedByFrontStacks.add(id)
    }
  }

  type Body = {
    key: string
    minZ: number
    kind: 'free' | 'legacy-stack' | 'nested-stack'
    memberIds: string[]
    stackId?: string
    front: boolean
  }

  const bodies: Body[] = []
  const seenLegacy = new Set<string>()
  const claimedItems = new Set<string>()
  const claimedStacks = new Set<string>()

  // All nested stacks on this surface
  for (const st of stacksInContainer(stacks, containerId)) {
    const treeIds = collectDescendantStackIds(stacks, st.id)
    for (const id of treeIds) claimedStacks.add(id)
    const treeItems = collectItemsInStackTree(items, stacks, st.id)
    for (const m of treeItems) claimedItems.add(m.id)
    bodies.push({
      key: `nested:${st.id}`,
      minZ: nestedStackUnitMinZ(st, items, stacks),
      kind: 'nested-stack',
      memberIds: treeItems.map((m) => m.id),
      stackId: st.id,
      front: frontRootStacks.includes(st.id),
    })
  }

  // Free items on this canvas (not inside a nested stack tree)
  for (const it of items) {
    if (claimedItems.has(it.id)) continue
    if (containerOf(it) !== containerId) continue
    if (claimedStacks.has(containerOf(it))) continue

    if (it.stacked && it.stackGroupId) {
      const gid = it.stackGroupId
      if (seenLegacy.has(gid)) continue
      if (stacks.some((s) => s.id === gid)) continue
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
        front: members.some((m) => frontItemSet.has(m.id)),
      })
    } else {
      claimedItems.add(it.id)
      bodies.push({
        key: `free:${it.id}`,
        minZ: it.zIndex,
        kind: 'free',
        memberIds: [it.id],
        front: frontItemSet.has(it.id),
      })
    }
  }

  // Also pick up selected free ids that might not be on container (skip)
  for (const id of frontItemSet) {
    if (claimedItems.has(id)) continue
    const it = byId.get(id)
    if (!it || containerOf(it) !== containerId) continue
    if (it.stacked) continue
    bodies.push({
      key: `free:${id}`,
      minZ: it.zIndex,
      kind: 'free',
      memberIds: [id],
      front: true,
    })
  }

  const rest = bodies
    .filter((b) => !b.front)
    .sort((a, b) => a.minZ - b.minZ || a.key.localeCompare(b.key))
  const pinned = bodies
    .filter((b) => b.front)
    .sort((a, b) => a.minZ - b.minZ || a.key.localeCompare(b.key))

  const promote = options?.promoteFreeId
  if (promote && !pinToBack) {
    const idx = pinned.findIndex(
      (b) => b.kind === 'free' && b.memberIds[0] === promote,
    )
    if (idx >= 0) {
      const [body] = pinned.splice(idx, 1)
      pinned.push(body)
    }
  }

  // pinToBack: selection block first (under); else rest first, selection on top
  const ordered = pinToBack ? [...pinned, ...rest] : [...rest, ...pinned]
  let z = options?.startZ ?? 1
  const itemZMap = new Map<string, number>()
  const stackZMap = new Map<string, number>()

  for (const body of ordered) {
    if (body.kind === 'nested-stack' && body.stackId) {
      const sub = allocateNestedStackTreeZ(items, stacks, body.stackId, z)
      for (const [id, vz] of sub.itemZMap) itemZMap.set(id, vz)
      for (const [id, vz] of sub.stackZMap) stackZMap.set(id, vz)
      z = sub.nextZ
    } else if (body.kind === 'legacy-stack') {
      z += 1
      for (const id of body.memberIds) itemZMap.set(id, z++)
    } else {
      for (const id of body.memberIds) itemZMap.set(id, z++)
    }
  }

  // Preserve nextZ above anything we did not rewrite (other containers)
  let maxOther = z - 1
  for (const it of items) {
    if (!itemZMap.has(it.id)) maxOther = Math.max(maxOther, it.zIndex)
  }
  for (const st of stacks) {
    if (!stackZMap.has(st.id)) maxOther = Math.max(maxOther, st.zIndex)
  }

  return { itemZMap, stackZMap, nextZ: Math.max(z, maxOther + 1) }
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
 * canvas — and **reflow the entire surface** so unselected sibling stacks stay
 * atomic too (folder + fan as one exclusive z block).
 *
 * `startZ` is accepted for API compatibility; reflow assigns dense z from 1
 * (plus anything on other containers left untouched).
 */
export function raiseSelectionZ(
  items: CanvasItem[],
  stacks: StackRecord[],
  selectedItemIds: string[],
  selectedStackIds: string[],
  _startZ: number,
  options?: {
    promoteFreeId?: string | null
    containerId?: string
    /** Send selection under other surface bodies (still atomic blocks). */
    pinToBack?: boolean
  },
): {
  itemZMap: Map<string, number>
  stackZMap: Map<string, number>
  nextZ: number
} {
  const containerId = options?.containerId ?? ROOT_CONTAINER_ID
  return reflowContainerSurfaceZ(items, stacks, containerId, {
    frontItemIds: selectedItemIds,
    frontStackIds: selectedStackIds,
    promoteFreeId: options?.promoteFreeId,
    pinToBack: options?.pinToBack,
    startZ: 1,
  })
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
