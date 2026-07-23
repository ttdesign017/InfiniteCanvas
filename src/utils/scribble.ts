import type { Point, ScribbleItem, ScribblePath } from '../types/canvas'
import { uid } from './id'

export function recomputeScribbleBounds(
  paths: ScribblePath[],
  pad: number,
): { x: number; y: number; width: number; height: number; paths: ScribblePath[] } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const path of paths) {
    for (const point of path.points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  if (!Number.isFinite(minX)) return null

  // Normalize paths so top-left of content is at (pad, pad) in local space
  const ox = minX - pad
  const oy = minY - pad
  const normalized = paths.map((path) => ({
    ...path,
    points: path.points.map((p) => ({ x: p.x - ox, y: p.y - oy })),
  }))

  return {
    x: ox,
    y: oy,
    width: Math.max(4, maxX - minX + pad * 2),
    height: Math.max(4, maxY - minY + pad * 2),
    paths: normalized,
  }
}

/**
 * Hot-path append used while the pointer is down.
 *
 * Keep the item's origin fixed and allow temporary negative local points. This
 * avoids shifting every previous point whenever a stroke expands left/up. The
 * SVG paints overflow during the gesture; normalizeScribbleItem runs once on
 * pointer-up to restore the persisted 0..width/height coordinate contract.
 */
export function appendScribbleWorldPoints(
  item: ScribbleItem,
  worldPoints: readonly Point[],
): ScribbleItem {
  if (worldPoints.length === 0 || item.paths.length === 0) return item
  const finite = worldPoints.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  )
  if (finite.length === 0) return item

  const local = finite.map((point) => ({
    x: point.x - item.x,
    y: point.y - item.y,
  }))
  const lastIndex = item.paths.length - 1
  const last = item.paths[lastIndex]
  const paths = item.paths.slice()
  paths[lastIndex] = {
    ...last,
    points: [...last.points, ...local],
  }

  const pad = Math.max(item.strokeWidth, last.width, 8)
  let width = item.width
  let height = item.height
  for (const point of local) {
    width = Math.max(width, point.x + pad)
    height = Math.max(height, point.y + pad)
  }
  return {
    ...item,
    paths,
    width: Math.max(4, width),
    height: Math.max(4, height),
  }
}

/** Normalize one live scribble in a single pass when its stroke finishes. */
export function normalizeScribbleItem(item: ScribbleItem): ScribbleItem {
  let minLocalX = Infinity
  let minLocalY = Infinity
  let maxLocalX = -Infinity
  let maxLocalY = -Infinity
  let pad = Math.max(item.strokeWidth, 8)

  for (const path of item.paths) {
    pad = Math.max(pad, path.width)
    for (const point of path.points) {
      minLocalX = Math.min(minLocalX, point.x)
      minLocalY = Math.min(minLocalY, point.y)
      maxLocalX = Math.max(maxLocalX, point.x)
      maxLocalY = Math.max(maxLocalY, point.y)
    }
  }
  if (!Number.isFinite(minLocalX)) return item

  const nextX = item.x + minLocalX - pad
  const nextY = item.y + minLocalY - pad
  const shiftX = item.x - nextX
  const shiftY = item.y - nextY
  return {
    ...item,
    x: nextX,
    y: nextY,
    width: Math.max(4, maxLocalX - minLocalX + pad * 2),
    height: Math.max(4, maxLocalY - minLocalY + pad * 2),
    paths: item.paths.map((path) => ({
      ...path,
      points: path.points.map((point) => ({
        x: point.x + shiftX,
        y: point.y + shiftY,
      })),
    })),
  }
}

/** Distance from point to segment */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Erase points within radius (local coords). Splits paths when middle points are removed.
 * Returns remaining paths (may be empty).
 */
export function eraseFromPaths(
  paths: ScribblePath[],
  localPoint: Point,
  radius: number,
): ScribblePath[] {
  const result: ScribblePath[] = []

  for (const path of paths) {
    if (path.points.length === 0) continue

    // Mark points too close to eraser
    const keep = path.points.map((p, i) => {
      // Also check segments to previous for better stroke erase feel
      if (Math.hypot(p.x - localPoint.x, p.y - localPoint.y) <= radius) return false
      if (i > 0) {
        const prev = path.points[i - 1]
        if (distToSegment(localPoint, prev, p) <= radius) return false
      }
      return true
    })

    // Also mark neighbors if segment was hit
    const keep2 = [...keep]
    for (let i = 0; i < path.points.length - 1; i++) {
      if (distToSegment(localPoint, path.points[i], path.points[i + 1]) <= radius) {
        keep2[i] = false
        keep2[i + 1] = false
      }
    }

    let current: Point[] = []
    const flush = () => {
      if (current.length >= 2) {
        result.push({
          id: uid('path'),
          points: current,
          color: path.color,
          width: path.width,
        })
      } else if (current.length === 1) {
        // keep single dots as tiny marks
        result.push({
          id: uid('path'),
          points: [current[0], { x: current[0].x + 0.1, y: current[0].y + 0.1 }],
          color: path.color,
          width: path.width,
        })
      }
      current = []
    }

    for (let i = 0; i < path.points.length; i++) {
      if (keep2[i]) current.push(path.points[i])
      else flush()
    }
    flush()
  }

  return result
}
