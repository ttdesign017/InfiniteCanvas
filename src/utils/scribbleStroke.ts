/**
 * Freehand stroke rendering (perfect-freehand), tuned toward AFFiNE pen feel.
 * Stores stay as raw centerline points; outline path is derived at paint time.
 */

import { getStroke } from 'perfect-freehand'
import type { Point } from '../types/canvas'

/** AFFiNE brush defaults (getSolidStrokePoints) + mild P1 tuning. */
export const SCRIBBLE_STROKE_OPTIONS = {
  /** Base diameter of the stroke */
  size: 4,
  /** Pressure → width (higher = more taper with velocity) */
  thinning: 0.6,
  /** Soften outline sampling */
  smoothing: 0.5,
  /** Input low-pass / “follow” smoothing — main smoothness lever */
  streamline: 0.55,
  /** Ease simulated pressure curve (AFFiNE: sin ease) */
  easing: (t: number) => Math.sin((t * Math.PI) / 2),
  /** No real pressure in store yet → derive from speed */
  simulatePressure: true,
} as const

export type ScribbleStrokeInputPoint = Point & { pressure?: number }

/**
 * Convert freehand outline points to a closed SVG path (quadratic midpoints).
 * Same approach as perfect-freehand docs / AFFiNE getSvgPathFromStroke.
 */
export function getSvgPathFromStroke(points: number[][], closed = true): string {
  const len = points.length
  if (len < 2) return ''

  let a = points[0]
  let b = points[1]
  let result = `M ${a[0].toFixed(2)} ${a[1].toFixed(2)} Q ${b[0].toFixed(2)} ${b[1].toFixed(2)} `

  if (len === 2) {
    result += `${average(b[0], a[0]).toFixed(2)} ${average(b[1], a[1]).toFixed(2)}`
  } else {
    const c = points[2]
    result += `${average(b[0], c[0]).toFixed(2)} ${average(b[1], c[1]).toFixed(2)} T`
    for (let i = 2, max = len - 1; i < max; i++) {
      a = points[i]
      b = points[i + 1]
      result += ` ${average(a[0], b[0]).toFixed(2)} ${average(a[1], b[1]).toFixed(2)}`
    }
  }

  if (closed) result += ' Z'
  return result
}

function average(a: number, b: number): number {
  return (a + b) / 2
}

export type BuildScribblePathOptions = {
  /** Stroke diameter (maps to perfect-freehand `size`). */
  size: number
  /**
   * When true, treat the stroke as finished (better end caps).
   * Live strokes should pass false.
   */
  last?: boolean
  /** Slightly expand size for invisible hit targets. */
  sizeBoost?: number
  /** Override simulatePressure (default true unless first point has pressure). */
  simulatePressure?: boolean
}

/**
 * Build a filled freehand SVG `d` for a centerline of scribble points.
 */
export function buildScribbleStrokePath(
  points: readonly ScribbleStrokeInputPoint[],
  options: BuildScribblePathOptions,
): string {
  if (points.length === 0) return ''

  const size = Math.max(0.5, options.size + (options.sizeBoost ?? 0))
  // Match AFFiNE: simulate pressure only when input is plain [x,y] (no pen pressure).
  const hasRealPressure = points.some(
    (p) => typeof p.pressure === 'number' && Number.isFinite(p.pressure),
  )
  const simulatePressure = options.simulatePressure ?? !hasRealPressure

  const input: Array<[number, number] | [number, number, number]> = points.map(
    (p) => {
      if (typeof p.pressure === 'number' && Number.isFinite(p.pressure)) {
        return [p.x, p.y, p.pressure]
      }
      return [p.x, p.y]
    },
  )

  // Single-dot: freehand needs at least a tiny segment
  if (input.length === 1) {
    const [x, y, pressure] = input[0] as [number, number, number?]
    input.push(
      pressure !== undefined
        ? [x + 0.01, y + 0.01, pressure]
        : [x + 0.01, y + 0.01],
    )
  }

  const outline = getStroke(input, {
    size,
    thinning: SCRIBBLE_STROKE_OPTIONS.thinning,
    smoothing: SCRIBBLE_STROKE_OPTIONS.smoothing,
    streamline: SCRIBBLE_STROKE_OPTIONS.streamline,
    easing: SCRIBBLE_STROKE_OPTIONS.easing,
    simulatePressure,
    last: options.last ?? true,
  })

  if (outline.length < 2) return ''
  return getSvgPathFromStroke(outline)
}
