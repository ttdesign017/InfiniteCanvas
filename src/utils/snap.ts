import type { CanvasItem } from '../types/canvas'
import { stackFolderBodyBounds } from './layout'

export interface SnapGuide {
  orientation: 'v' | 'h'
  /** World coordinate of the guide line */
  pos: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
}

export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

/** Default snap distance in world units (callers pass screen-scaled values) */
const DEFAULT_THRESHOLD = 10

/**
 * Snap targets:
 * - Free items → own rect
 * - Stacks → large rounded folder body (not name tab, not card fan)
 */
export function collectSnapBodies(
  allItems: CanvasItem[],
  excludeIds: Set<string>,
): RectLike[] {
  const bodies: RectLike[] = []
  const seenGroups = new Set<string>()

  for (const item of allItems) {
    if (excludeIds.has(item.id)) continue

    if (item.stackGroupId && item.stacked) {
      if (seenGroups.has(item.stackGroupId)) continue
      seenGroups.add(item.stackGroupId)

      const members = allItems.filter(
        (i) => i.stackGroupId === item.stackGroupId && i.stacked,
      )
      // Whole stack is moving together → skip as target
      if (members.some((m) => excludeIds.has(m.id))) continue

      const b = stackFolderBodyBounds(members)
      if (b) bodies.push(b)
      continue
    }

    bodies.push({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    })
  }

  return bodies
}

/**
 * Bounds of the moving set for snap.
 * Stacks use folder body edges (rounded rect), not the name tab.
 */
export function movingSnapBounds(moving: CanvasItem[]): RectLike | null {
  if (moving.length === 0) return null

  const groups = new Map<string, CanvasItem[]>()
  const free: CanvasItem[] = []

  for (const m of moving) {
    if (m.stacked && m.stackGroupId) {
      const list = groups.get(m.stackGroupId) || []
      list.push(m)
      groups.set(m.stackGroupId, list)
    } else {
      free.push(m)
    }
  }

  const rects: RectLike[] = []
  for (const members of groups.values()) {
    const b = stackFolderBodyBounds(members)
    if (b) rects.push(b)
  }
  for (const f of free) {
    rects.push({ x: f.x, y: f.y, width: f.width, height: f.height })
  }

  if (rects.length === 0) return null
  if (rects.length === 1) return rects[0]

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function edgesFromBodies(bodies: RectLike[]) {
  const targetsV: number[] = []
  const targetsH: number[] = []
  for (const b of bodies) {
    targetsV.push(b.x, b.x + b.width / 2, b.x + b.width)
    targetsH.push(b.y, b.y + b.height / 2, b.y + b.height)
  }
  return { targetsV, targetsH }
}

export function guidesEqual(a: SnapGuide[], b: SnapGuide[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].orientation !== b[i].orientation || a[i].pos !== b[i].pos) return false
  }
  return true
}

/**
 * Snap a selection as a group to other bodies' edges and centers.
 */
export function computeSnapDelta(
  moving: CanvasItem[],
  allItems: CanvasItem[],
  threshold = DEFAULT_THRESHOLD,
): SnapResult {
  if (moving.length === 0) return { dx: 0, dy: 0, guides: [] }

  const moveIds = new Set(moving.map((i) => i.id))
  const bounds = movingSnapBounds(moving)
  if (!bounds) return { dx: 0, dy: 0, guides: [] }

  const bodies = collectSnapBodies(allItems, moveIds)
  if (bodies.length === 0) return { dx: 0, dy: 0, guides: [] }

  const { targetsV, targetsH } = edgesFromBodies(bodies)

  const selV = [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width]
  const selH = [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height]

  let bestDx = 0
  let bestAbsX = threshold + 1
  let guideV: number | null = null

  for (const s of selV) {
    for (const t of targetsV) {
      const d = t - s
      const a = Math.abs(d)
      if (a <= threshold && a < bestAbsX) {
        bestAbsX = a
        bestDx = d
        guideV = t
      }
    }
  }

  let bestDy = 0
  let bestAbsY = threshold + 1
  let guideH: number | null = null

  for (const s of selH) {
    for (const t of targetsH) {
      const d = t - s
      const a = Math.abs(d)
      if (a <= threshold && a < bestAbsY) {
        bestAbsY = a
        bestDy = d
        guideH = t
      }
    }
  }

  const guides: SnapGuide[] = []
  if (guideV !== null && bestAbsX <= threshold) guides.push({ orientation: 'v', pos: guideV })
  if (guideH !== null && bestAbsY <= threshold) guides.push({ orientation: 'h', pos: guideH })

  return {
    dx: bestAbsX <= threshold ? bestDx : 0,
    dy: bestAbsY <= threshold ? bestDy : 0,
    guides,
  }
}

export function enforceAspectFromHandle(
  rect: RectLike,
  aspect: number,
  handle: string,
  minSize = 24,
): RectLike {
  const h = (handle || 'se').toLowerCase()
  const a = Math.max(1e-6, aspect)
  const fixL = h.includes('e')
  const fixT = h.includes('s')
  const fixR = h.includes('w')
  const fixB = h.includes('n')

  const byW = Math.max(minSize, rect.width)
  const hFromW = Math.max(minSize, byW / a)
  const byH = Math.max(minSize, rect.height)
  const wFromH = Math.max(minSize, byH * a)

  const errW = Math.abs(hFromW - rect.height) + Math.abs(byW - rect.width)
  const errH = Math.abs(wFromH - rect.width) + Math.abs(byH - rect.height)
  let width = errW <= errH ? byW : wFromH
  let height = errW <= errH ? hFromW : byH

  let x = rect.x
  let y = rect.y
  if (fixR) x = rect.x + rect.width - width
  else if (fixL) x = rect.x
  if (fixB) y = rect.y + rect.height - height
  else if (fixT) y = rect.y

  if (h === 'e' || h === 'w') {
    y = rect.y + rect.height / 2 - height / 2
    if (h === 'w') x = rect.x + rect.width - width
    else x = rect.x
  }
  if (h === 'n' || h === 's') {
    x = rect.x + rect.width / 2 - width / 2
    if (h === 'n') y = rect.y + rect.height - height
    else y = rect.y
  }

  return { x, y, width, height }
}

/**
 * Snap free edges of a resized rect to nearby bodies.
 *
 * Root cause of "guides but no snap": aspect re-lock ran AFTER snap and
 * moved free edges off the guide while guides still pointed at the snap line.
 *
 * Strategy when aspect is locked:
 * 1) Find the best free-edge snap candidate (by distance)
 * 2) Apply that snap
 * 3) Re-derive the other free dimension from aspect (fixed corner stays put)
 * Guides always match the applied geometry.
 */
export function snapResizeRect(
  rect: RectLike,
  handle: string,
  selfId: string,
  allItems: CanvasItem[],
  threshold = DEFAULT_THRESHOLD,
  aspect?: number,
): { rect: RectLike; guides: SnapGuide[] } {
  const exclude = new Set<string>([selfId])
  const self = allItems.find((i) => i.id === selfId)
  if (self?.stackGroupId) {
    for (const i of allItems) {
      if (i.stackGroupId === self.stackGroupId) exclude.add(i.id)
    }
  }

  const bodies = collectSnapBodies(allItems, exclude)
  if (bodies.length === 0) return { rect, guides: [] }

  const { targetsV, targetsH } = edgesFromBodies(bodies)
  const h = (handle || '').toLowerCase()
  const minSize = 24

  const freeL = h === 'w' || h === 'nw' || h === 'sw'
  const freeR = h === 'e' || h === 'ne' || h === 'se'
  const freeT = h === 'n' || h === 'nw' || h === 'ne'
  const freeB = h === 's' || h === 'sw' || h === 'se'

  type Cand = {
    axis: 'v' | 'h'
    /** Which free edge */
    edge: 'l' | 'r' | 't' | 'b'
    target: number
    dist: number
  }

  const nearest = (v: number, targets: number[]): { target: number; dist: number } | null => {
    let bestT = 0
    let bestD = threshold + 1
    let found = false
    for (const t of targets) {
      const d = Math.abs(t - v)
      if (d <= threshold && d < bestD) {
        bestD = d
        bestT = t
        found = true
      }
    }
    return found ? { target: bestT, dist: bestD } : null
  }

  const cands: Cand[] = []
  if (freeL) {
    const n = nearest(rect.x, targetsV)
    if (n) cands.push({ axis: 'v', edge: 'l', target: n.target, dist: n.dist })
  }
  if (freeR) {
    const n = nearest(rect.x + rect.width, targetsV)
    if (n) cands.push({ axis: 'v', edge: 'r', target: n.target, dist: n.dist })
  }
  if (freeT) {
    const n = nearest(rect.y, targetsH)
    if (n) cands.push({ axis: 'h', edge: 't', target: n.target, dist: n.dist })
  }
  if (freeB) {
    const n = nearest(rect.y + rect.height, targetsH)
    if (n) cands.push({ axis: 'h', edge: 'b', target: n.target, dist: n.dist })
  }

  if (cands.length === 0) return { rect, guides: [] }

  // Closest free-edge wins (stable sticky snap)
  cands.sort((a, b) => a.dist - b.dist)
  const best = cands[0]

  let { x, y, width, height } = rect
  const guides: SnapGuide[] = []

  const applyEdge = (edge: Cand['edge'], target: number) => {
    if (edge === 'l') {
      const newW = x + width - target
      if (newW >= minSize) {
        width = newW
        x = target
        guides.push({ orientation: 'v', pos: target })
        return true
      }
    } else if (edge === 'r') {
      const newW = target - x
      if (newW >= minSize) {
        width = newW
        guides.push({ orientation: 'v', pos: target })
        return true
      }
    } else if (edge === 't') {
      const newH = y + height - target
      if (newH >= minSize) {
        height = newH
        y = target
        guides.push({ orientation: 'h', pos: target })
        return true
      }
    } else if (edge === 'b') {
      const newH = target - y
      if (newH >= minSize) {
        height = newH
        guides.push({ orientation: 'h', pos: target })
        return true
      }
    }
    return false
  }

  if (!applyEdge(best.edge, best.target)) {
    return { rect, guides: [] }
  }

  // Keep aspect from fixed corner AFTER snap so free edge stays on the guide
  // for the snapped axis; the other free dim follows aspect.
  if (aspect != null && aspect > 0) {
    const a = Math.max(1e-6, aspect)
    // Fixed corner opposite the free handle
    const fixR = freeL && !freeR
    const fixB = freeT && !freeB
    const fixL = freeR && !freeL
    const fixT = freeB && !freeT
    // Corners free both axes: fixed is opposite corner
    const corner = h.length === 2

    if (best.axis === 'v') {
      // Width is authoritative (snapped); height from aspect
      height = Math.max(minSize, width / a)
      if (corner) {
        if (h.includes('n')) y = rect.y + rect.height - height
        // se/sw: top fixed (y unchanged)
      } else if (h === 'e' || h === 'w') {
        // mid-edge: keep vertical center
        y = rect.y + rect.height / 2 - height / 2
      }
    } else {
      // Height authoritative; width from aspect
      width = Math.max(minSize, height * a)
      if (corner) {
        if (h.includes('w')) x = rect.x + rect.width - width
      } else if (h === 'n' || h === 's') {
        x = rect.x + rect.width / 2 - width / 2
      }
    }

    // Suppress unused fixed flags for lint — kept for clarity of intent
    void fixR
    void fixB
    void fixL
    void fixT
  } else {
    // No aspect: also try the second-closest free edge on the other axis
    const second = cands.find((c) => c.axis !== best.axis)
    if (second) {
      applyEdge(second.edge, second.target)
    }
  }

  return { rect: { x, y, width, height }, guides }
}
