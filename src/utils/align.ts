import type { CanvasItem, StackRecord } from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import {
  stackCollapsedSnapBounds,
  stackFolderBodyBounds,
} from './layout'
import { collectItemsInStackTree, containerOf } from './stacks'

/** Gap between touching edges when packing under "gravity" */
const PACK_MARGIN = 5

export type AlignMode =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'centerH'
  | 'centerV'

export type PackDir = 'left' | 'right' | 'up' | 'down'

/** Rigid body for align/pack: one free item or one whole stack */
export interface AlignBody {
  ids: string[]
  /** Nested stack folder id when body is a StackRecord */
  stackId?: string
  x: number
  y: number
  width: number
  height: number
}

export interface AlignContext {
  stacks?: StackRecord[]
  selectedStackIds?: string[]
  containerId?: string
}

/**
 * Build align bodies from selection.
 * - Nested StackRecords → folder body (single unit)
 * - Legacy stacked members → folder body from cards
 * - Free items → own rect
 */
export function collectAlignBodies(
  selectedIds: string[],
  allItems: CanvasItem[],
  ctx: AlignContext = {},
): AlignBody[] {
  const byId = new Map(allItems.map((i) => [i.id, i]))
  const seen = new Set<string>()
  const bodies: AlignBody[] = []
  const stacks = ctx.stacks ?? []
  const selectedStackIds = ctx.selectedStackIds ?? []
  const containerId = ctx.containerId ?? ROOT_CONTAINER_ID

  // Selected enterable stacks on this canvas (bounds include nested leaf content)
  for (const sid of selectedStackIds) {
    const st = stacks.find((s) => s.id === sid && s.parentId === containerId)
    if (!st) continue
    const leaves = collectItemsInStackTree(allItems, stacks, sid)
    for (const m of leaves) seen.add(m.id)
    const b = stackCollapsedSnapBounds(st, leaves)
    bodies.push({
      ids: leaves.map((m) => m.id),
      stackId: sid,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    })
  }

  for (const id of selectedIds) {
    if (seen.has(id)) continue
    const item = byId.get(id)
    if (!item || item.locked) continue
    if (containerOf(item) !== containerId) continue

    if (item.stacked && item.stackGroupId) {
      // Skip if already represented as StackRecord
      if (stacks.some((s) => s.id === item.stackGroupId)) {
        seen.add(id)
        continue
      }
      const gid = item.stackGroupId
      const members = allItems.filter(
        (i) => i.stackGroupId === gid && i.stacked,
      )
      for (const m of members) seen.add(m.id)
      const b = stackFolderBodyBounds(members)
      if (!b) continue
      bodies.push({
        ids: members.map((m) => m.id),
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      })
      continue
    }

    seen.add(id)
    bodies.push({
      ids: [id],
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    })
  }

  return bodies
}

function groupBounds(bodies: AlignBody[]) {
  const minX = Math.min(...bodies.map((b) => b.x))
  const minY = Math.min(...bodies.map((b) => b.y))
  const maxX = Math.max(...bodies.map((b) => b.x + b.width))
  const maxY = Math.max(...bodies.map((b) => b.y + b.height))
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  }
}

function rangesOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  eps = 0.5,
): boolean {
  return a0 < b1 - eps && a1 > b0 + eps
}

/**
 * Align bodies to selection edges / centers.
 * Returns per-item position deltas and optional stack folder deltas.
 */
export function computeAlignPatches(
  selectedIds: string[],
  allItems: CanvasItem[],
  mode: AlignMode,
  ctx: AlignContext = {},
): {
  itemPatches: Array<{ id: string; dx: number; dy: number }>
  stackPatches: Array<{ id: string; dx: number; dy: number }>
} {
  const bodies = collectAlignBodies(selectedIds, allItems, ctx)
  if (bodies.length < 2) return { itemPatches: [], stackPatches: [] }

  const g = groupBounds(bodies)
  const itemPatches: Array<{ id: string; dx: number; dy: number }> = []
  const stackPatches: Array<{ id: string; dx: number; dy: number }> = []

  for (const body of bodies) {
    let dx = 0
    let dy = 0
    switch (mode) {
      case 'left':
        dx = g.minX - body.x
        break
      case 'right':
        dx = g.maxX - (body.x + body.width)
        break
      case 'top':
        dy = g.minY - body.y
        break
      case 'bottom':
        dy = g.maxY - (body.y + body.height)
        break
      case 'centerH':
        dx = g.cx - (body.x + body.width / 2)
        break
      case 'centerV':
        dy = g.cy - (body.y + body.height / 2)
        break
    }
    if (dx === 0 && dy === 0) continue
    if (body.stackId) {
      stackPatches.push({ id: body.stackId, dx, dy })
      // Nested members move via stackPreview when folder moves — not item x/y
    } else {
      for (const id of body.ids) {
        itemPatches.push({ id, dx, dy })
      }
    }
  }

  return { itemPatches, stackPatches }
}

/**
 * Pack bodies toward a side (close gaps).
 */
export function computePackPatches(
  selectedIds: string[],
  allItems: CanvasItem[],
  dir: PackDir,
  ctx: AlignContext = {},
): {
  itemPatches: Array<{ id: string; dx: number; dy: number }>
  stackPatches: Array<{ id: string; dx: number; dy: number }>
} {
  const bodies = collectAlignBodies(selectedIds, allItems, ctx)
  if (bodies.length < 2) return { itemPatches: [], stackPatches: [] }

  const horizontal = dir === 'left' || dir === 'right'
  const sorted = [...bodies].sort((a, b) => {
    if (horizontal) {
      return dir === 'left' ? a.x - b.x : b.x + b.width - (a.x + a.width)
    }
    return dir === 'up' ? a.y - b.y : b.y + b.height - (a.y + a.height)
  })

  const itemPatches: Array<{ id: string; dx: number; dy: number }> = []
  const stackPatches: Array<{ id: string; dx: number; dy: number }> = []
  const placed: AlignBody[] = []

  for (const body of sorted) {
    let dx = 0
    let dy = 0

    if (horizontal) {
      if (dir === 'left') {
        let edge = -Infinity
        for (const p of placed) {
          if (
            rangesOverlap(body.y, body.y + body.height, p.y, p.y + p.height)
          ) {
            edge = Math.max(edge, p.x + p.width + PACK_MARGIN)
          }
        }
        if (edge > -Infinity) dx = edge - body.x
      } else {
        let edge = Infinity
        for (const p of placed) {
          if (
            rangesOverlap(body.y, body.y + body.height, p.y, p.y + p.height)
          ) {
            edge = Math.min(edge, p.x - PACK_MARGIN)
          }
        }
        if (edge < Infinity) dx = edge - (body.x + body.width)
      }
    } else if (dir === 'up') {
      let edge = -Infinity
      for (const p of placed) {
        if (rangesOverlap(body.x, body.x + body.width, p.x, p.x + p.width)) {
          edge = Math.max(edge, p.y + p.height + PACK_MARGIN)
        }
      }
      if (edge > -Infinity) dy = edge - body.y
    } else {
      let edge = Infinity
      for (const p of placed) {
        if (rangesOverlap(body.x, body.x + body.width, p.x, p.x + p.width)) {
          edge = Math.min(edge, p.y - PACK_MARGIN)
        }
      }
      if (edge < Infinity) dy = edge - (body.y + body.height)
    }

    const next = {
      ...body,
      x: body.x + dx,
      y: body.y + dy,
    }
    placed.push(next)

    if (dx === 0 && dy === 0) continue
    if (body.stackId) {
      stackPatches.push({ id: body.stackId, dx, dy })
    } else {
      for (const id of body.ids) {
        itemPatches.push({ id, dx, dy })
      }
    }
  }

  return { itemPatches, stackPatches }
}
