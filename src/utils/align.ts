import type { CanvasItem } from '../types/canvas'
import { stackGroupBounds } from './layout'

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
  x: number
  y: number
  width: number
  height: number
}

/**
 * Build align bodies from selection.
 * Stacked members sharing stackGroupId → one folder-bound body.
 */
export function collectAlignBodies(
  selectedIds: string[],
  allItems: CanvasItem[],
): AlignBody[] {
  const byId = new Map(allItems.map((i) => [i.id, i]))
  const seen = new Set<string>()
  const bodies: AlignBody[] = []

  for (const id of selectedIds) {
    if (seen.has(id)) continue
    const item = byId.get(id)
    if (!item || item.locked) continue

    if (item.stacked && item.stackGroupId) {
      const gid = item.stackGroupId
      const members = allItems.filter(
        (i) => i.stackGroupId === gid && i.stacked,
      )
      for (const m of members) seen.add(m.id)
      const b = stackGroupBounds(members, 20)
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
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
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
 * Returns per-item position deltas (dx, dy) for every member id.
 */
export function computeAlignPatches(
  selectedIds: string[],
  allItems: CanvasItem[],
  mode: AlignMode,
): Array<{ id: string; dx: number; dy: number }> {
  const bodies = collectAlignBodies(selectedIds, allItems)
  if (bodies.length < 2) return []

  const g = groupBounds(bodies)
  const patches: Array<{ id: string; dx: number; dy: number }> = []

  for (const b of bodies) {
    let dx = 0
    let dy = 0
    switch (mode) {
      case 'left':
        dx = g.minX - b.x
        break
      case 'right':
        dx = g.maxX - (b.x + b.width)
        break
      case 'top':
        dy = g.minY - b.y
        break
      case 'bottom':
        dy = g.maxY - (b.y + b.height)
        break
      case 'centerH':
        dx = g.cx - (b.x + b.width / 2)
        break
      case 'centerV':
        dy = g.cy - (b.y + b.height / 2)
        break
    }
    if (dx === 0 && dy === 0) continue
    for (const id of b.ids) patches.push({ id, dx, dy })
  }

  return patches
}

/**
 * Gravity pack / 靠拢 — NOT align, NOT single-file shelf packing.
 *
 * Ctrl+Left: every body falls left under gravity.
 *  - Wall = leftmost edge among selection (alignment line).
 *  - A body stops at the wall, or when its left side hits another body's
 *    right side (PACK_MARGIN gap) — only if their Y ranges overlap.
 *  - Bodies that don't share vertical space all fall to the same wall.
 *  - No leftover gaps if something can still move left.
 * Other directions mirror this.
 */
export function computePackPatches(
  selectedIds: string[],
  allItems: CanvasItem[],
  dir: PackDir,
): Array<{ id: string; dx: number; dy: number }> {
  const bodies = collectAlignBodies(selectedIds, allItems)
  if (bodies.length < 2) return []

  const patches: Array<{ id: string; dx: number; dy: number }> = []
  const settled: Array<{ x: number; y: number; width: number; height: number }> =
    []

  if (dir === 'left') {
    const wall = Math.min(...bodies.map((b) => b.x))
    // Process left→right so blockers settle first
    const sorted = [...bodies].sort((a, b) => a.x - b.x || a.y - b.y)

    for (const b of sorted) {
      // Fall all the way to the wall unless a settled body blocks on Y
      let targetX = wall
      for (const p of settled) {
        if (
          rangesOverlap(b.y, b.y + b.height, p.y, p.y + p.height)
        ) {
          targetX = Math.max(targetX, p.x + p.width + PACK_MARGIN)
        }
      }
      const dx = targetX - b.x
      if (Math.abs(dx) > 0.01) {
        for (const id of b.ids) patches.push({ id, dx, dy: 0 })
      }
      settled.push({
        x: targetX,
        y: b.y,
        width: b.width,
        height: b.height,
      })
    }
    return patches
  }

  if (dir === 'right') {
    const wall = Math.max(...bodies.map((b) => b.x + b.width))
    const sorted = [...bodies].sort(
      (a, b) => b.x + b.width - (a.x + a.width) || a.y - b.y,
    )

    for (const b of sorted) {
      let targetRight = wall
      for (const p of settled) {
        if (
          rangesOverlap(b.y, b.y + b.height, p.y, p.y + p.height)
        ) {
          targetRight = Math.min(targetRight, p.x - PACK_MARGIN)
        }
      }
      const targetX = targetRight - b.width
      const dx = targetX - b.x
      if (Math.abs(dx) > 0.01) {
        for (const id of b.ids) patches.push({ id, dx, dy: 0 })
      }
      settled.push({
        x: targetX,
        y: b.y,
        width: b.width,
        height: b.height,
      })
    }
    return patches
  }

  if (dir === 'up') {
    const wall = Math.min(...bodies.map((b) => b.y))
    const sorted = [...bodies].sort((a, b) => a.y - b.y || a.x - b.x)

    for (const b of sorted) {
      let targetY = wall
      for (const p of settled) {
        if (
          rangesOverlap(b.x, b.x + b.width, p.x, p.x + p.width)
        ) {
          targetY = Math.max(targetY, p.y + p.height + PACK_MARGIN)
        }
      }
      const dy = targetY - b.y
      if (Math.abs(dy) > 0.01) {
        for (const id of b.ids) patches.push({ id, dx: 0, dy })
      }
      settled.push({
        x: b.x,
        y: targetY,
        width: b.width,
        height: b.height,
      })
    }
    return patches
  }

  // down
  const wall = Math.max(...bodies.map((b) => b.y + b.height))
  const sorted = [...bodies].sort(
    (a, b) => b.y + b.height - (a.y + a.height) || a.x - b.x,
  )

  for (const b of sorted) {
    let targetBottom = wall
    for (const p of settled) {
      if (rangesOverlap(b.x, b.x + b.width, p.x, p.x + p.width)) {
        targetBottom = Math.min(targetBottom, p.y - PACK_MARGIN)
      }
    }
    const targetY = targetBottom - b.height
    const dy = targetY - b.y
    if (Math.abs(dy) > 0.01) {
      for (const id of b.ids) patches.push({ id, dx: 0, dy })
    }
    settled.push({
      x: b.x,
      y: targetY,
      width: b.width,
      height: b.height,
    })
  }

  return patches
}
