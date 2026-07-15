/**
 * Pure item-list patch helpers — no Zustand coupling.
 * Keeps document mutations testable and free of store chrome.
 */

import type { CanvasItem } from '../types/canvas'

export type ItemPatch = { id: string; patch: Partial<CanvasItem> }

/** Apply a single-id patch; returns the same array reference if id missing. */
export function applyItemPatch(
  items: CanvasItem[],
  id: string,
  patch: Partial<CanvasItem>,
): CanvasItem[] {
  let changed = false
  const next = items.map((item) => {
    if (item.id !== id) return item
    changed = true
    return { ...item, ...patch } as CanvasItem
  })
  return changed ? next : items
}

/** Apply many patches in one pass (last patch per id wins). */
export function applyItemPatches(
  items: CanvasItem[],
  patches: ItemPatch[],
): CanvasItem[] {
  if (patches.length === 0) return items
  const map = new Map(patches.map((p) => [p.id, p.patch]))
  let changed = false
  const next = items.map((item) => {
    const patch = map.get(item.id)
    if (!patch) return item
    changed = true
    return { ...item, ...patch } as CanvasItem
  })
  return changed ? next : items
}
