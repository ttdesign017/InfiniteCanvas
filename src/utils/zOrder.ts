import type { CanvasItem } from '../types/canvas'

/**
 * Raise selected items as atomic bodies (free item or whole stack).
 * Stacks reserve one z slot under their members for folder chrome so
 * free items cannot sit between the folder and stack content.
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
