import { describe, expect, it } from 'vitest'
import type { CanvasItem } from '../../types/canvas'
import {
  applyGroupScale,
  computeSelectionBounds,
  groupScaleAnchor,
  isGroupScalableType,
} from '../selectionBounds'

const media = (
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 80,
): CanvasItem =>
  ({
    id,
    type: 'image',
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    zIndex: 1,
    src: 'data:image/png;base64,AQID',
    naturalWidth: w,
    naturalHeight: h,
  }) as CanvasItem

describe('computeSelectionBounds', () => {
  it('unions free selected items on the active canvas', () => {
    const items = [media('a', 0, 0), media('b', 100, 0)]
    const b = computeSelectionBounds(items, [], ['a', 'b'], [], 'root')
    expect(b).toMatchObject({ x: 0, y: 0, width: 200, height: 80 })
  })

  it('returns null when nothing selectable is selected', () => {
    expect(computeSelectionBounds([], [], [], [], 'root')).toBeNull()
  })
})

describe('groupScaleAnchor + applyGroupScale', () => {
  it('maps se handle anchor to top-left of the group box', () => {
    const bounds = { x: 10, y: 20, width: 100, height: 80 }
    expect(groupScaleAnchor(bounds, 'se')).toEqual({ x: 10, y: 20 })
  })

  it('scales media size and only repositions non-scalable notes', () => {
    expect(isGroupScalableType('image')).toBe(true)
    expect(isGroupScalableType('text')).toBe(false)

    const bounds = { x: 0, y: 0, width: 200, height: 100 }
    const origins = [
      {
        id: 'img',
        kind: 'item' as const,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        scalable: true,
      },
      {
        id: 'note',
        kind: 'item' as const,
        x: 100,
        y: 0,
        width: 80,
        height: 40,
        scalable: false,
      },
    ]
    const patches = applyGroupScale(origins, bounds, 'se', 2)
    const img = patches.find((p) => p.id === 'img' && p.kind === 'item')
    const n = patches.find((p) => p.id === 'note' && p.kind === 'item')
    expect(img).toMatchObject({ width: 200, height: 200 })
    // note keeps size, center moves with scale from se anchor (0,0)
    expect(n).toMatchObject({ width: 80, height: 40 })
    // center was (140,20) → (280,40); keep 80×40 → x=240, y=20
    expect((n as { x: number }).x).toBeCloseTo(240)
    expect((n as { y: number }).y).toBeCloseTo(20)
  })
})
