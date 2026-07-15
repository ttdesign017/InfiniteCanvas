import { describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import { cloneItemsForHistory, cloneStacksForHistory } from '../cloneDocument'

describe('history snapshots', () => {
  it('copies mutable media metadata while retaining the immutable source value', () => {
    const items: CanvasItem[] = [
      {
        id: 'image-1',
        type: 'image',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        zIndex: 1,
        src: `data:image/png;base64,${'A'.repeat(1024)}`,
        naturalWidth: 100,
        naturalHeight: 100,
        crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      },
    ]
    const cloned = cloneItemsForHistory(items)
    expect(cloned[0]).not.toBe(items[0])
    expect(cloned[0].type === 'image' && cloned[0].src).toBe(
      items[0].type === 'image' ? items[0].src : '',
    )
    if (cloned[0].type === 'image' && items[0].type === 'image') {
      expect(cloned[0].crop).not.toBe(items[0].crop)
    }
  })

  it('deep-copies scribble points and nested stack fan poses', () => {
    const items: CanvasItem[] = [
      {
        id: 'stroke-1',
        type: 'scribble',
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        rotation: 0,
        zIndex: 1,
        strokeColor: '#111',
        strokeWidth: 2,
        paths: [
          { id: 'path-1', color: '#111', width: 2, points: [{ x: 1, y: 2 }] },
        ],
      },
    ]
    const stacks: StackRecord[] = [
      {
        id: 'stack-1',
        parentId: 'root',
        name: 'Ideas',
        x: 0,
        y: 0,
        width: 200,
        height: 140,
        zIndex: 2,
        freeFanRel: [{ id: 'stroke-1', dx: 5, dy: 8, rotation: -4 }],
      },
    ]
    const clonedItems = cloneItemsForHistory(items)
    const clonedStacks = cloneStacksForHistory(stacks)
    expect(clonedItems[0].type === 'scribble' && clonedItems[0].paths[0].points[0]).not.toBe(
      items[0].type === 'scribble' ? items[0].paths[0].points[0] : undefined,
    )
    expect(clonedStacks[0].freeFanRel?.[0]).not.toBe(stacks[0].freeFanRel?.[0])
  })
})
