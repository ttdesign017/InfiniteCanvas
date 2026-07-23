import { describe, expect, it } from 'vitest'
import type { ScribbleItem } from '../../types/canvas'
import {
  appendScribbleWorldPoints,
  normalizeScribbleItem,
  recomputeScribbleBounds,
} from '../scribble'

function scribble(): ScribbleItem {
  return {
    id: 'scribble-1',
    type: 'scribble',
    x: 100,
    y: 100,
    width: 16,
    height: 16,
    rotation: 0,
    zIndex: 1,
    strokeColor: '#111',
    strokeWidth: 4,
    paths: [
      {
        id: 'path-1',
        color: '#111',
        width: 4,
        points: [{ x: 8, y: 8 }],
      },
    ],
  }
}

function worldPoints(item: ScribbleItem) {
  return item.paths.flatMap((path) =>
    path.points.map((point) => ({
      x: item.x + point.x,
      y: item.y + point.y,
    })),
  )
}

describe('scribble hot path', () => {
  it('batches live points without shifting the existing path', () => {
    const before = scribble()
    const existingPoint = before.paths[0].points[0]
    const next = appendScribbleWorldPoints(before, [
      { x: 50, y: 75 },
      { x: 220, y: 240 },
    ])

    expect(next.x).toBe(before.x)
    expect(next.y).toBe(before.y)
    expect(next.paths[0].points[0]).toBe(existingPoint)
    expect(next.paths[0].points.slice(1)).toEqual([
      { x: -50, y: -25 },
      { x: 120, y: 140 },
    ])
  })

  it('normalizes once while preserving every world coordinate', () => {
    const live = appendScribbleWorldPoints(scribble(), [
      { x: 50, y: 75 },
      { x: 220, y: 240 },
    ])
    const before = worldPoints(live)
    const normalized = normalizeScribbleItem(live)

    expect(worldPoints(normalized)).toEqual(before)
    expect(normalized.paths[0].points.every((point) => point.x >= 0)).toBe(true)
    expect(normalized.paths[0].points.every((point) => point.y >= 0)).toBe(true)
    expect(normalized.width).toBeGreaterThanOrEqual(186)
    expect(normalized.height).toBeGreaterThanOrEqual(181)
  })

  it('computes bounds for a large stroke without argument-spread limits', () => {
    const points = Array.from({ length: 150_000 }, (_, index) => ({
      x: index,
      y: -index,
    }))
    const bounds = recomputeScribbleBounds(
      [{ id: 'large', color: '#000', width: 2, points }],
      8,
    )

    expect(bounds).not.toBeNull()
    expect(bounds?.width).toBe(150_015)
    expect(bounds?.height).toBe(150_015)
  })
})
