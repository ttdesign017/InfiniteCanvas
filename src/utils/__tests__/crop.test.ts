import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../../types/canvas'
import {
  applyWorldCrop,
  isAxisAlignedForCrop,
  uncropFrame,
} from '../crop'

const image = (overrides: Partial<MediaItem> = {}): MediaItem => ({
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
  ...overrides,
})

describe('crop eligibility', () => {
  it('allows crop only when the item is axis-aligned', () => {
    expect(isAxisAlignedForCrop(image({ rotation: 0 }))).toBe(true)
    expect(isAxisAlignedForCrop(image({ rotation: 0.0001 }))).toBe(true)
    expect(isAxisAlignedForCrop(image({ rotation: 15 }))).toBe(false)
    expect(isAxisAlignedForCrop(image({ rotation: 90 }))).toBe(false)
  })

  it('refuses world crop while the media is rotated', () => {
    const result = applyWorldCrop(image({ rotation: 30 }), {
      x: 50,
      y: 25,
      width: 100,
      height: 50,
    })
    expect(result).toBeNull()
  })

  it('refuses a marquee that is too small to form a crop', () => {
    expect(
      applyWorldCrop(image(), { x: 10, y: 10, width: 2, height: 2 }),
    ).toBeNull()
    expect(
      applyWorldCrop(image(), { x: 10, y: 10, width: 20, height: 4 }),
    ).toBeNull()
  })
})

describe('crop and uncrop geometry', () => {
  it('writes a normalized crop rect and shrinks the display frame', () => {
    const result = applyWorldCrop(image(), {
      x: 50,
      y: 25,
      width: 100,
      height: 50,
    })
    expect(result).toMatchObject({
      crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      x: 50,
      y: 25,
      width: 100,
      height: 50,
    })
  })

  it('uncrops back to the full source frame at the current scale', () => {
    const cropped = applyWorldCrop(image(), {
      x: 50,
      y: 25,
      width: 100,
      height: 50,
    })
    const restored = uncropFrame({ ...image(), ...cropped! })
    expect(restored).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })

  it('keeps the visible crop center fixed when uncropping a rotated item', () => {
    // Crop region already applied: right half of a 200×100 box at origin
    const cropped = image({
      x: 100,
      y: 0,
      width: 100,
      height: 100,
      rotation: 90,
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    })
    // Visible center before uncrop (layout box center)
    const cx = cropped.x + cropped.width / 2
    const cy = cropped.y + cropped.height / 2

    const restored = uncropFrame(cropped)
    expect(restored).not.toBeNull()
    // Full width = 100/0.5 = 200, full height = 100/1 = 100
    expect(restored!.width).toBeCloseTo(200)
    expect(restored!.height).toBeCloseTo(100)

    // After uncrop, the old crop-region center should still sit at (cx, cy)
    // under CSS center-origin rotation — verified by uncropFrame math.
    const fullW = restored!.width
    const fullH = restored!.height
    const ox = (0.5 + 0.5 / 2 - 0.5) * fullW // crop center offset in local px
    const oy = (0 + 1 / 2 - 0.5) * fullH
    const rot = (90 * Math.PI) / 180
    const ncx = restored!.x + fullW / 2
    const ncy = restored!.y + fullH / 2
    const visibleCx = ncx + (ox * Math.cos(rot) - oy * Math.sin(rot))
    const visibleCy = ncy + (ox * Math.sin(rot) + oy * Math.cos(rot))
    expect(visibleCx).toBeCloseTo(cx)
    expect(visibleCy).toBeCloseTo(cy)
  })

  it('returns null when there is nothing to uncrop', () => {
    expect(uncropFrame(image())).toBeNull()
    expect(
      uncropFrame(image({ crop: { x: 0, y: 0, w: 1, h: 1 } })),
    ).toBeNull()
  })
})
