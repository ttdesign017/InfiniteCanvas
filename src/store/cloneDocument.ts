/**
 * History / snapshot clones that avoid duplicating multi-MB media strings.
 *
 * `structuredClone` of a `data:` URL copies the entire base64 payload per
 * history entry. Strings are immutable — we shallow-copy items and *share*
 * media src / link image references across snapshots.
 */

import type { CanvasItem, StackRecord } from '../types/canvas'

/** Clone items for undo history — share heavy immutable media strings. */
export function cloneItemsForHistory(items: CanvasItem[]): CanvasItem[] {
  return items.map((item) => {
    switch (item.type) {
      case 'image':
      case 'gif':
      case 'video':
        return {
          ...item,
          crop: item.crop ? { ...item.crop } : undefined,
        }
      case 'audio':
        return { ...item }
      case 'link':
        return { ...item }
      case 'scribble':
        return {
          ...item,
          paths: item.paths.map((p) => ({
            ...p,
            points: p.points.map((pt) => ({ x: pt.x, y: pt.y })),
          })),
        }
      case 'embed':
        return { ...item }
      case 'text':
        return { ...item }
      case 'textcard':
        return { ...item }
      default: {
        // Exhaustiveness fallback — keep a shallow object copy
        const fallback = item as CanvasItem
        return { ...fallback }
      }
    }
  })
}

/** Full structural clone for export / clipboard (safe independent trees). */
export function cloneItemsDeep(items: CanvasItem[]): CanvasItem[] {
  return structuredClone(items)
}

export function cloneStacksForHistory(stacks: StackRecord[]): StackRecord[] {
  return stacks.map((st) => ({
    ...st,
    viewport: st.viewport ? { ...st.viewport } : undefined,
    freeFanRel: st.freeFanRel
      ? st.freeFanRel.map((f) => ({ ...f }))
      : undefined,
  }))
}

export function cloneStacksDeep(stacks: StackRecord[]): StackRecord[] {
  return structuredClone(stacks)
}
