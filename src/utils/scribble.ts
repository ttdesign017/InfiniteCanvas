import type { Point, ScribblePath } from '../types/canvas'
import { uid } from './id'

export function recomputeScribbleBounds(
  paths: ScribblePath[],
  pad: number,
): { x: number; y: number; width: number; height: number; paths: ScribblePath[] } | null {
  const all = paths.flatMap((p) => p.points)
  if (all.length === 0) return null

  const minX = Math.min(...all.map((p) => p.x))
  const minY = Math.min(...all.map((p) => p.y))
  const maxX = Math.max(...all.map((p) => p.x))
  const maxY = Math.max(...all.map((p) => p.y))

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
