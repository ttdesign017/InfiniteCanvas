import { describe, expect, it } from 'vitest'
import type { CanvasItem, MediaItem } from '../../../types/canvas'
import { resolveCropTargets } from '../cropTargets'

const media = (
  id: string,
  overrides: Partial<MediaItem> = {},
): MediaItem => ({
  id,
  type: 'image',
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  rotation: 0,
  zIndex: 1,
  src: 'data:image/png;base64,AQID',
  naturalWidth: 100,
  naturalHeight: 80,
  ...overrides,
})

describe('resolveCropTargets', () => {
  it('returns multi-selected free media for joint crop', () => {
    const items: CanvasItem[] = [
      media('a', { x: 0, y: 0 }),
      media('b', { x: 200, y: 0 }),
    ]
    const result = resolveCropTargets(
      { x: 10, y: 10 },
      items,
      ['a', 'b'],
      [],
      'root',
    )
    expect(result.rotatedOnly).toBe(false)
    expect(result.ids.sort()).toEqual(['a', 'b'])
  })

  it('reports rotatedOnly when every candidate is rotated', () => {
    const items: CanvasItem[] = [media('a', { rotation: 30 })]
    const result = resolveCropTargets(
      { x: 10, y: 10 },
      items,
      ['a'],
      [],
      'root',
    )
    expect(result.ids).toEqual([])
    expect(result.rotatedOnly).toBe(true)
  })

  it('ignores media that live inside nested stacks', () => {
    const items: CanvasItem[] = [
      media('inside', { containerId: 'stack-a', x: 0, y: 0 }),
    ]
    const result = resolveCropTargets(
      { x: 10, y: 10 },
      items,
      [],
      [],
      'root',
    )
    expect(result.ids).toEqual([])
  })
})
