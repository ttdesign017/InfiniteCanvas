import type { CanvasItem } from '../types/canvas'
import { stackGroupBounds } from './layout'

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

const DEFAULT_THRESHOLD = 10

/**
 * Build snap target bodies:
 * - Unstacked items → themselves
 * - Stacked groups → outer folder bounds only (not inner cards)
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
      // If any member is being moved, skip as target (whole group moves together)
      if (members.some((m) => excludeIds.has(m.id))) continue

      const b = stackGroupBounds(members, 20)
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
 * Each stack is treated as one rigid body (folder outer bounds).
 * Free items keep their own rects. Multi-stack moves use the union of folder bounds.
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
    const b = stackGroupBounds(members, 20)
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

/**
 * After free-edge snap, re-lock aspect ratio from the fixed corner of `handle`.
 * Call this when keepAspect was true so snap cannot break proportions.
 */
export function enforceAspectFromHandle(
  rect: RectLike,
  aspect: number,
  handle: string,
  minSize = 24,
): RectLike {
  const h = (handle || 'se').toLowerCase()
  const a = Math.max(1e-6, aspect)
  // Fixed corner = opposite of the free handle
  const fixL = h.includes('e') // free right → left fixed
  const fixT = h.includes('s') // free bottom → top fixed
  const fixR = h.includes('w')
  const fixB = h.includes('n')

  // Drive from the dimension that better matches current snap result
  const byW = Math.max(minSize, rect.width)
  const hFromW = Math.max(minSize, byW / a)
  const byH = Math.max(minSize, rect.height)
  const wFromH = Math.max(minSize, byH * a)

  // Prefer the scale closer to the pre-enforce rect (less jump)
  const errW = Math.abs(hFromW - rect.height) + Math.abs(byW - rect.width)
  const errH = Math.abs(wFromH - rect.width) + Math.abs(byH - rect.height)
  let width = errW <= errH ? byW : wFromH
  let height = errW <= errH ? hFromW : byH

  // Re-anchor to fixed corner(s)
  let x = rect.x
  let y = rect.y
  if (fixR) x = rect.x + rect.width - width
  else if (fixL) x = rect.x
  if (fixB) y = rect.y + rect.height - height
  else if (fixT) y = rect.y

  // Mid-edge free handles (e/w/n/s with uniform scale): keep center on fixed axis
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
 * Snap free edges of a resized rect to nearby bodies (stack folder outer edges).
 * When `aspect` is provided, snap is applied then proportion is re-locked.
 */
export function snapResizeRect(
  rect: RectLike,
  handle: string,
  selfId: string,
  allItems: CanvasItem[],
  threshold = DEFAULT_THRESHOLD,
  /** If set, aspect (width/height) is forced after snap */
  aspect?: number,
): { rect: RectLike; guides: SnapGuide[] } {
  const exclude = new Set<string>([selfId])
  // If self is in a stack, exclude whole stack as targets
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
  let { x, y, width, height } = rect
  const guides: SnapGuide[] = []
  const minSize = 24

  const nearest = (v: number, targets: number[]) => {
    let best = v
    let bestA = threshold + 1
    let hit: number | null = null
    for (const t of targets) {
      const a = Math.abs(t - v)
      if (a <= threshold && a < bestA) {
        bestA = a
        best = t
        hit = t
      }
    }
    return { v: best, hit }
  }

  const freeL = h === 'w' || h === 'nw' || h === 'sw'
  const freeR = h === 'e' || h === 'ne' || h === 'se'
  const freeT = h === 'n' || h === 'nw' || h === 'ne'
  const freeB = h === 's' || h === 'sw' || h === 'se'

  if (freeL) {
    const { v, hit } = nearest(x, targetsV)
    if (hit !== null) {
      const newW = x + width - v
      if (newW >= minSize) {
        width = newW
        x = v
        guides.push({ orientation: 'v', pos: hit })
      }
    }
  }
  if (freeR) {
    const right = x + width
    const { v, hit } = nearest(right, targetsV)
    if (hit !== null) {
      const newW = v - x
      if (newW >= minSize) {
        width = newW
        guides.push({ orientation: 'v', pos: hit })
      }
    }
  }
  if (freeT) {
    const { v, hit } = nearest(y, targetsH)
    if (hit !== null) {
      const newH = y + height - v
      if (newH >= minSize) {
        height = newH
        y = v
        guides.push({ orientation: 'h', pos: hit })
      }
    }
  }
  if (freeB) {
    const bottom = y + height
    const { v, hit } = nearest(bottom, targetsH)
    if (hit !== null) {
      const newH = v - y
      if (newH >= minSize) {
        height = newH
        guides.push({ orientation: 'h', pos: hit })
      }
    }
  }

  let out: RectLike = { x, y, width, height }
  // Proportional resize: snap may break ratio — re-lock from fixed corner
  if (aspect != null && aspect > 0) {
    out = enforceAspectFromHandle(out, aspect, h, minSize)
  }
  return { rect: out, guides }
}
