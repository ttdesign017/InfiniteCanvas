import { describe, expect, it } from 'vitest'
import {
  aabbIntersects,
  cullItemsForPaint,
  itemIntersectsCullRect,
  worldRectFromViewport,
} from '../viewportCull'

describe('viewportCull', () => {
  it('maps screen viewport to world rect with margin', () => {
    const world = worldRectFromViewport(
      { x: 100, y: 50, zoom: 1 },
      1000,
      800,
      0,
    )
    // screen 0 → world (0-100)/1 = -100
    expect(world.x).toBeCloseTo(-100)
    expect(world.y).toBeCloseTo(-50)
    expect(world.width).toBeCloseTo(1000)
    expect(world.height).toBeCloseTo(800)
  })

  it('scales margin by inverse zoom', () => {
    const world = worldRectFromViewport(
      { x: 0, y: 0, zoom: 2 },
      400,
      400,
      100,
    )
    // margin world = 100/2 = 50; base world 0..200
    expect(world.x).toBeCloseTo(-50)
    expect(world.width).toBeCloseTo(300)
  })

  it('detects AABB overlap', () => {
    expect(
      aabbIntersects(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 5, width: 10, height: 10 },
      ),
    ).toBe(true)
    expect(
      aabbIntersects(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 20, width: 5, height: 5 },
      ),
    ).toBe(false)
  })

  it('keeps alwaysKeep ids outside the frustum', () => {
    const cull = { x: 0, y: 0, width: 100, height: 100 }
    const items = [
      { id: 'in', x: 10, y: 10, width: 20, height: 20 },
      { id: 'out', x: 500, y: 500, width: 20, height: 20 },
      { id: 'sel', x: 900, y: 900, width: 20, height: 20 },
    ]
    const painted = cullItemsForPaint(items, cull, new Set(['sel']))
    expect(painted.map((i) => i.id).sort()).toEqual(['in', 'sel'])
  })

  it('rotated item uses world AABB for intersection', () => {
    const cull = { x: 0, y: 0, width: 50, height: 50 }
    // Centered near origin, large rotated box may still hit
    const item = { x: 40, y: 40, width: 30, height: 10, rotation: 45 }
    expect(itemIntersectsCullRect(item, cull)).toBe(true)
  })
})
