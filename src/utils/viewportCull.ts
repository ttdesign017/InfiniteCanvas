/**
 * Viewport culling helpers — world AABB vs expanded screen frustum.
 */

import type { Viewport } from '../types/canvas'
import {
  itemWorldAABB,
  type BoundsRect,
  type RectLike,
} from './geometry'

/** Convert screen viewport + CSS transform into a world-space AABB. */
export function worldRectFromViewport(
  viewport: Viewport,
  screenW: number,
  screenH: number,
  /** Extra margin in CSS pixels (converted by zoom). */
  marginPx = 240,
): BoundsRect {
  const z = Math.max(0.05, viewport.zoom)
  const m = marginPx / z
  const x0 = (0 - viewport.x) / z - m
  const y0 = (0 - viewport.y) / z - m
  const x1 = (screenW - viewport.x) / z + m
  const y1 = (screenH - viewport.y) / z + m
  return {
    x: x0,
    y: y0,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  }
}

export function aabbIntersects(a: BoundsRect, b: BoundsRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

/** True if the item's rotated world AABB intersects the cull rect. */
export function itemIntersectsCullRect(
  item: RectLike,
  cull: BoundsRect,
): boolean {
  return aabbIntersects(itemWorldAABB(item), cull)
}

export function boundsIntersectsCullRect(
  bounds: BoundsRect,
  cull: BoundsRect,
): boolean {
  return aabbIntersects(bounds, cull)
}

/**
 * Filter items for paint. Always keeps ids in `alwaysKeep`.
 * When `cull` is null (e.g. animating), returns all items.
 */
export function cullItemsForPaint<T extends RectLike & { id: string }>(
  items: T[],
  cull: BoundsRect | null,
  alwaysKeep?: ReadonlySet<string>,
): T[] {
  if (!cull) return items
  if (!alwaysKeep || alwaysKeep.size === 0) {
    return items.filter((it) => itemIntersectsCullRect(it, cull))
  }
  return items.filter(
    (it) => alwaysKeep.has(it.id) || itemIntersectsCullRect(it, cull),
  )
}
