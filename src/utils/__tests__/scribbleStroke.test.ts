import { describe, expect, it } from 'vitest'
import {
  buildScribbleStrokePath,
  getSvgPathFromStroke,
  SCRIBBLE_STROKE_OPTIONS,
} from '../scribbleStroke'

describe('scribbleStroke freehand', () => {
  it('exposes AFFiNE-like stroke tuning', () => {
    expect(SCRIBBLE_STROKE_OPTIONS.thinning).toBe(0.6)
    expect(SCRIBBLE_STROKE_OPTIONS.streamline).toBeGreaterThanOrEqual(0.5)
    expect(SCRIBBLE_STROKE_OPTIONS.smoothing).toBe(0.5)
    expect(SCRIBBLE_STROKE_OPTIONS.simulatePressure).toBe(true)
  })

  it('builds a closed fill path from a polyline', () => {
    const d = buildScribbleStrokePath(
      [
        { x: 0, y: 0 },
        { x: 20, y: 4 },
        { x: 40, y: 2 },
        { x: 60, y: 10 },
      ],
      { size: 4, last: true },
    )
    expect(d.startsWith('M ')).toBe(true)
    expect(d.includes('Z') || d.trimEnd().endsWith('Z')).toBe(true)
    // Filled freehand, not a polyline of L segments only
    expect(d.includes('Q') || d.includes('T')).toBe(true)
  })

  it('handles a single point as a small filled mark', () => {
    const d = buildScribbleStrokePath([{ x: 10, y: 10 }], {
      size: 6,
      last: true,
    })
    expect(d.length).toBeGreaterThan(10)
    expect(d.startsWith('M ')).toBe(true)
  })

  it('produces a larger outline when sizeBoost is set (hit target)', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 8 },
    ]
    const paint = buildScribbleStrokePath(points, { size: 4, last: true })
    const hit = buildScribbleStrokePath(points, {
      size: 4,
      sizeBoost: 12,
      last: true,
    })
    expect(paint).not.toBe(hit)
    expect(hit.length).toBeGreaterThan(0)
  })

  it('getSvgPathFromStroke closes the outline', () => {
    const d = getSvgPathFromStroke([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ])
    expect(d.includes('Z')).toBe(true)
  })

  it('uses real pressure when provided and disables simulatePressure', () => {
    const d = buildScribbleStrokePath(
      [
        { x: 0, y: 0, pressure: 0.3 },
        { x: 20, y: 0, pressure: 0.9 },
        { x: 40, y: 5, pressure: 0.5 },
      ],
      { size: 8, last: true, simulatePressure: false },
    )
    expect(d.startsWith('M ')).toBe(true)
  })
})
