/**
 * Multi-selection bounding box + proportional group scale helpers.
 * Corner + edge handles mirror single-media scale (uniform aspect).
 */

import type { CanvasItem, StackRecord } from '../types/canvas'
import { itemWorldAABB, unionAABB, type BoundsRect } from './geometry'
import { stackCollapsedSnapBounds } from './layout'
import { collectItemsInStackTree, containerOf } from './stacks'

export type { BoundsRect }

/** Types that change size under group scale (others only reposition). */
export function isGroupScalableType(type: string): boolean {
  return (
    type === 'image' ||
    type === 'gif' ||
    type === 'video' ||
    type === 'scribble'
  )
}

/**
 * Axis-aligned bounds of free selected items + selected stack folders
 * (folder + fan hull) on the current canvas.
 *
 * Free items use **rotation-aware** world AABB (CSS center origin).
 */
export function computeSelectionBounds(
  items: CanvasItem[],
  stacks: StackRecord[],
  selectedIds: string[],
  selectedStackIds: string[],
  containerId: string,
): BoundsRect | null {
  let acc: BoundsRect | null = null

  const idSet = new Set(selectedIds)
  for (const it of items) {
    if (!idSet.has(it.id)) continue
    if (it.stacked) continue
    if (containerOf(it) !== containerId) continue
    acc = unionAABB(acc, itemWorldAABB(it))
  }

  const stackSet = new Set(selectedStackIds)
  for (const st of stacks) {
    if (!stackSet.has(st.id)) continue
    if (st.parentId !== containerId) continue
    const leaves = collectItemsInStackTree(items, stacks, st.id)
    const b = stackCollapsedSnapBounds(st, leaves)
    acc = unionAABB(acc, b)
  }

  return acc
}

/** Corner + edge handles (same set as single media resize). */
export type GroupScaleHandle =
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se'
  | 'n'
  | 'e'
  | 's'
  | 'w'

/** Fixed opposite side/corner of a scale handle (world space). */
export function groupScaleAnchor(
  bounds: BoundsRect,
  handle: GroupScaleHandle,
): { x: number; y: number } {
  const midX = bounds.x + bounds.width / 2
  const midY = bounds.y + bounds.height / 2
  const r = bounds.x + bounds.width
  const b = bounds.y + bounds.height
  switch (handle) {
    case 'nw':
      return { x: r, y: b }
    case 'ne':
      return { x: bounds.x, y: b }
    case 'sw':
      return { x: r, y: bounds.y }
    case 'se':
      return { x: bounds.x, y: bounds.y }
    case 'n':
      return { x: midX, y: b }
    case 's':
      return { x: midX, y: bounds.y }
    case 'w':
      return { x: r, y: midY }
    case 'e':
      return { x: bounds.x, y: midY }
  }
}

/**
 * Uniform scale factor from pointer — corners use diagonal projection,
 * edges use the free axis (same idea as single-media edge scale).
 */
export function groupScaleFactor(
  bounds: BoundsRect,
  handle: GroupScaleHandle,
  worldX: number,
  worldY: number,
): number {
  const clamp = (f: number) => Math.min(8, Math.max(0.05, f))
  const w = Math.max(1e-6, bounds.width)
  const h = Math.max(1e-6, bounds.height)

  switch (handle) {
    case 'e':
      return clamp((worldX - bounds.x) / w)
    case 'w':
      return clamp((bounds.x + bounds.width - worldX) / w)
    case 's':
      return clamp((worldY - bounds.y) / h)
    case 'n':
      return clamp((bounds.y + bounds.height - worldY) / h)
    default: {
      const anchor = groupScaleAnchor(bounds, handle)
      const origCorner = {
        nw: { x: bounds.x, y: bounds.y },
        ne: { x: bounds.x + bounds.width, y: bounds.y },
        sw: { x: bounds.x, y: bounds.y + bounds.height },
        se: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      }[handle]
      const origDx = origCorner.x - anchor.x
      const origDy = origCorner.y - anchor.y
      const origLen = Math.hypot(origDx, origDy) || 1
      const curDx = worldX - anchor.x
      const curDy = worldY - anchor.y
      const proj = (curDx * origDx + curDy * origDy) / (origLen * origLen)
      return clamp(proj)
    }
  }
}

/**
 * Bounds after uniform scale from handle anchor
 * (all four corners of the original box scaled about the anchor).
 */
export function groupScaledBounds(
  bounds: BoundsRect,
  handle: GroupScaleHandle,
  factor: number,
): BoundsRect {
  const a = groupScaleAnchor(bounds, handle)
  const pts = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((p) => ({
    x: a.x + (p.x - a.x) * factor,
    y: a.y + (p.y - a.y) * factor,
  }))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(24, maxX - minX),
    height: Math.max(24, maxY - minY),
  }
}

/**
 * Recover uniform factor after snap adjusted the group box.
 * Prefers the free axis of the active handle.
 */
export function groupFactorFromSnappedBox(
  orig: BoundsRect,
  snapped: BoundsRect,
  handle: GroupScaleHandle,
): number {
  const clamp = (f: number) => Math.min(8, Math.max(0.05, f))
  const ow = Math.max(1e-6, orig.width)
  const oh = Math.max(1e-6, orig.height)
  switch (handle) {
    case 'e':
    case 'w':
      return clamp(snapped.width / ow)
    case 'n':
    case 's':
      return clamp(snapped.height / oh)
    default:
      return clamp(
        (snapped.width / ow + snapped.height / oh) / 2,
      )
  }
}

export interface GroupBodyOrigin {
  id: string
  kind: 'item' | 'stack'
  x: number
  y: number
  width: number
  height: number
  /** Item only */
  rotation?: number
  scalable: boolean
}

/**
 * Apply proportional group scale from anchor: scalable types change size;
 * others only move so their center tracks the scaled layout.
 */
export function applyGroupScale(
  origins: GroupBodyOrigin[],
  bounds: BoundsRect,
  handle: GroupScaleHandle,
  factor: number,
): Array<
  | { kind: 'item'; id: string; x: number; y: number; width: number; height: number }
  | { kind: 'stack'; id: string; x: number; y: number }
> {
  const anchor = groupScaleAnchor(bounds, handle)
  const out: Array<
    | { kind: 'item'; id: string; x: number; y: number; width: number; height: number }
    | { kind: 'stack'; id: string; x: number; y: number }
  > = []

  for (const o of origins) {
    const cx = o.x + o.width / 2
    const cy = o.y + o.height / 2
    const ncx = anchor.x + (cx - anchor.x) * factor
    const ncy = anchor.y + (cy - anchor.y) * factor
    if (o.kind === 'stack') {
      out.push({
        kind: 'stack',
        id: o.id,
        x: ncx - o.width / 2,
        y: ncy - o.height / 2,
      })
      continue
    }
    if (o.scalable) {
      const nw = Math.max(24, o.width * factor)
      const nh = Math.max(24, o.height * factor)
      out.push({
        kind: 'item',
        id: o.id,
        x: ncx - nw / 2,
        y: ncy - nh / 2,
        width: nw,
        height: nh,
      })
    } else {
      out.push({
        kind: 'item',
        id: o.id,
        x: ncx - o.width / 2,
        y: ncy - o.height / 2,
        width: o.width,
        height: o.height,
      })
    }
  }
  return out
}
