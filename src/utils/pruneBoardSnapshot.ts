/**
 * Strip orphaned / deleted references before pack so .icanvas only embeds
 * live items and their media (no stale freeFanRel / assets for deleted leaves).
 */

import type { BoardSnapshot, CanvasItem, StackRecord } from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { containerOf } from './stacks'

/**
 * Return a cleaned snapshot safe to pack:
 * - drop stacks with missing parents (except root children)
 * - freeFanRel only keeps ids that still exist as items
 * - drop stackPreview when the item is free (optional hygiene)
 * - items list is already the source of truth for pack (no ghost media)
 */
export function pruneBoardSnapshotForSave(snapshot: BoardSnapshot): BoardSnapshot {
  const stacks = snapshot.stacks ?? []
  const stackIds = new Set(stacks.map((s) => s.id))

  // Keep stacks whose parent is root or another kept stack (iterative)
  let nextStacks = stacks.filter(
    (s) =>
      s.parentId === ROOT_CONTAINER_ID ||
      s.parentId === 'root' ||
      stackIds.has(s.parentId),
  )
  // Drop stacks that reference missing parents after first filter
  const keepIds = new Set(nextStacks.map((s) => s.id))
  nextStacks = nextStacks.filter(
    (s) =>
      s.parentId === ROOT_CONTAINER_ID ||
      s.parentId === 'root' ||
      keepIds.has(s.parentId),
  )
  // Items only in surviving stacks / root
  const validStackIds = new Set(nextStacks.map((s) => s.id))
  const items = snapshot.items.filter((it) => {
    const cid = containerOf(it)
    return cid === ROOT_CONTAINER_ID || validStackIds.has(cid)
  })
  const liveIds = new Set(items.map((i) => i.id))

  const prunedStacks: StackRecord[] = nextStacks.map((st) => {
    if (!st.freeFanRel?.length) return { ...st }
    const freeFanRel = st.freeFanRel.filter((r) => liveIds.has(r.id))
    return {
      ...st,
      freeFanRel: freeFanRel.length > 0 ? freeFanRel : undefined,
    }
  })

  const prunedItems: CanvasItem[] = items.map((it) => {
    // stackPreview only meaningful when nested in a stack
    if (containerOf(it) === ROOT_CONTAINER_ID && it.stackPreview) {
      const { stackPreview: _sp, ...rest } = it
      return rest as CanvasItem
    }
    return it
  })

  return {
    ...snapshot,
    items: prunedItems,
    stacks: prunedStacks,
  }
}

/** Src strings that should remain in pack-asset session cache after save. */
export function collectLiveMediaSrcs(items: CanvasItem[]): Set<string> {
  const out = new Set<string>()
  for (const it of items) {
    if (
      it.type === 'image' ||
      it.type === 'gif' ||
      it.type === 'video' ||
      it.type === 'audio'
    ) {
      if (it.src) out.add(it.src)
    }
    if (it.type === 'link') {
      if (it.image) out.add(it.image)
      if (it.favicon) out.add(it.favicon)
    }
  }
  return out
}
