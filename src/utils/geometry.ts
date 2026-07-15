/**
 * World-space geometry helpers matching canvas CSS transforms:
 * `translate(x,y) rotate(deg)` with `transform-origin: center center`.
 */

export type RectLike = {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export type BoundsRect = { x: number; y: number; width: number; height: number }
export type Point = { x: number; y: number }

/** Geometric center of the unrotated layout box (same as CSS transform-origin center). */
export function itemCenter(item: RectLike): Point {
  return {
    x: item.x + item.width / 2,
    y: item.y + item.height / 2,
  }
}

/** Four corners of the rotated item in world space. */
export function itemWorldCorners(item: RectLike): Point[] {
  const cx = item.x + item.width / 2
  const cy = item.y + item.height / 2
  const hw = item.width / 2
  const hh = item.height / 2
  const rot = ((item.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const local = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ]
  return local.map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }))
}

/** Axis-aligned bounding box of a possibly rotated item. */
export function itemWorldAABB(item: RectLike): BoundsRect {
  const corners = itemWorldCorners(item)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of corners) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x)
    maxY = Math.max(maxY, c.y)
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

/**
 * Point-in-rotated-rect test (center origin).
 * Uses inverse rotation into local box coordinates.
 */
export function pointInRotatedItem(world: Point, item: RectLike): boolean {
  const local = worldToItemLocal(item, world)
  return (
    local.x >= 0 &&
    local.x <= item.width &&
    local.y >= 0 &&
    local.y <= item.height
  )
}

/**
 * World → item-local (top-left origin of the unrotated layout box).
 * Matches CSS `translate(x,y) rotate(θ)` with `transform-origin: center`.
 */
export function worldToItemLocal(item: RectLike, world: Point): Point {
  const cx = item.x + item.width / 2
  const cy = item.y + item.height / 2
  const dx = world.x - cx
  const dy = world.y - cy
  const rot = ((item.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  // R^-1 * (world - C) then shift by half-size to top-left local
  const lcx = dx * cos + dy * sin
  const lcy = -dx * sin + dy * cos
  return { x: lcx + item.width / 2, y: lcy + item.height / 2 }
}

/** Item-local (top-left) → world. */
export function itemLocalToWorld(item: RectLike, local: Point): Point {
  const cx = item.x + item.width / 2
  const cy = item.y + item.height / 2
  const lcx = local.x - item.width / 2
  const lcy = local.y - item.height / 2
  const rot = ((item.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  return {
    x: cx + lcx * cos - lcy * sin,
    y: cy + lcx * sin + lcy * cos,
  }
}

/** Clip a convex polygon to an axis-aligned rect (Sutherland–Hodgman). */
export function clipPolygonToAabb(
  poly: Point[],
  rect: BoundsRect,
): Point[] {
  if (poly.length === 0) return []
  const edges: Array<(p: Point) => boolean> = [
    (p) => p.x >= rect.x,
    (p) => p.x <= rect.x + rect.width,
    (p) => p.y >= rect.y,
    (p) => p.y <= rect.y + rect.height,
  ]
  const intersect = (
    a: Point,
    b: Point,
    edge: number,
  ): Point => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (edge === 0) {
      // x = rect.x
      const t = Math.abs(dx) < 1e-12 ? 0 : (rect.x - a.x) / dx
      return { x: rect.x, y: a.y + t * dy }
    }
    if (edge === 1) {
      const t = Math.abs(dx) < 1e-12 ? 0 : (rect.x + rect.width - a.x) / dx
      return { x: rect.x + rect.width, y: a.y + t * dy }
    }
    if (edge === 2) {
      const t = Math.abs(dy) < 1e-12 ? 0 : (rect.y - a.y) / dy
      return { x: a.x + t * dx, y: rect.y }
    }
    const t = Math.abs(dy) < 1e-12 ? 0 : (rect.y + rect.height - a.y) / dy
    return { x: a.x + t * dx, y: rect.y + rect.height }
  }

  let output = poly
  for (let e = 0; e < 4; e++) {
    if (output.length === 0) return []
    const input = output
    output = []
    const inside = edges[e]
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]
      const prev = input[(i + input.length - 1) % input.length]
      const curIn = inside(cur)
      const prevIn = inside(prev)
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur, e))
        output.push(cur)
      } else if (prevIn) {
        output.push(intersect(prev, cur, e))
      }
    }
  }
  return output
}

export function polygonAABB(poly: Point[]): BoundsRect | null {
  if (poly.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  }
}

/** Expand an AABB by another AABB. */
export function unionAABB(
  a: BoundsRect | null,
  b: BoundsRect,
): BoundsRect {
  if (!a) return { ...b }
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.width, b.x + b.width)
  const maxY = Math.max(a.y + a.height, b.y + b.height)
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

export function pointInAABB(p: Point, box: BoundsRect): boolean {
  return (
    p.x >= box.x &&
    p.x <= box.x + box.width &&
    p.y >= box.y &&
    p.y <= box.y + box.height
  )
}

export function aabbIntersects(a: BoundsRect, b: BoundsRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

/**
 * Does axis-aligned marquee (world) intersect the *visual* rotated item?
 * Uses SAT between AABB and OBB (center-origin), matching canvas render.
 */
export function marqueeHitsRotatedItem(
  marquee: BoundsRect,
  item: RectLike,
): boolean {
  const rot = item.rotation || 0
  if (Math.abs(rot) < 0.05) {
    // Fast path: unrotated layout box
    return aabbIntersects(marquee, {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    })
  }

  // Quick reject with rotation-aware AABB
  const aabb = itemWorldAABB(item)
  if (!aabbIntersects(marquee, aabb)) return false

  // SAT: axes = world X/Y + item local axes
  const corners = itemWorldCorners(item)
  const mqCorners: Point[] = [
    { x: marquee.x, y: marquee.y },
    { x: marquee.x + marquee.width, y: marquee.y },
    { x: marquee.x + marquee.width, y: marquee.y + marquee.height },
    { x: marquee.x, y: marquee.y + marquee.height },
  ]

  const rad = (rot * Math.PI) / 180
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: Math.cos(rad), y: Math.sin(rad) },
    { x: -Math.sin(rad), y: Math.cos(rad) },
  ]

  const project = (pts: Point[], axis: Point) => {
    let min = Infinity
    let max = -Infinity
    for (const p of pts) {
      const d = p.x * axis.x + p.y * axis.y
      min = Math.min(min, d)
      max = Math.max(max, d)
    }
    return { min, max }
  }

  for (const axis of axes) {
    const a = project(mqCorners, axis)
    const b = project(corners, axis)
    if (a.max < b.min || b.max < a.min) return false
  }
  return true
}
