import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../../types/canvas'
import { applyWorldCrop, uncropFrame } from '../crop'
import { itemWorldAABB, pointInRotatedItem } from '../geometry'

const image: MediaItem = {
  id: 'image-1',
  type: 'image',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  rotation: 0,
  zIndex: 1,
  src: 'data:image/png;base64,AQID',
  naturalWidth: 400,
  naturalHeight: 200,
}

describe('rotated item geometry', () => {
  it('computes the visual AABB around a rotated rectangle', () => {
    const bounds = itemWorldAABB({ ...image, rotation: 90 })
    expect(bounds.x).toBeCloseTo(50)
    expect(bounds.y).toBeCloseTo(-50)
    expect(bounds.width).toBeCloseTo(100)
    expect(bounds.height).toBeCloseTo(200)
  })

  it('tests points in the rotated visual shape, not its layout box', () => {
    const rotated = { ...image, rotation: 45 }
    expect(pointInRotatedItem({ x: 100, y: 50 }, rotated)).toBe(true)
    expect(pointInRotatedItem({ x: 20, y: -20 }, rotated)).toBe(false)
  })
})

describe('crop round trip', () => {
  it('expands a cropped frame back to the original world rectangle', () => {
    const cropped = applyWorldCrop(image, {
      x: 50,
      y: 25,
      width: 100,
      height: 50,
    })
    expect(cropped).not.toBeNull()
    expect(cropped?.crop).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })

    const restored = uncropFrame({ ...image, ...cropped })
    expect(restored).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })
})
