import { afterEach, describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import {
  clearAllStackFanComposites,
  sortFanItemsStable,
  stackFanContentKey,
  stackFanCompositeCacheSize,
} from '../stackFanComposite'

afterEach(() => {
  clearAllStackFanComposites()
})

describe('stackFanContentKey', () => {
  const stack: StackRecord = {
    id: 's1',
    parentId: 'root',
    name: 'A',
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    zIndex: 1,
  }

  it('does NOT change when stack is only moved (drag must not rebuild fan)', () => {
    const items: CanvasItem[] = [
      {
        id: 'm1',
        type: 'image',
        src: 'blob:x',
        naturalWidth: 10,
        naturalHeight: 10,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        rotation: 0,
        zIndex: 2,
        containerId: 's1',
        // Absolute stackPreview; relative to folder stays same if both move by dx
        stackPreview: { x: 22, y: 34, rotation: 5 },
      },
    ]
    const k1 = stackFanContentKey(stack, items, [stack])
    // Folder moved + stackPreview absolute coords moved by same delta (as store does)
    const moved: StackRecord = { ...stack, x: 110, y: 220 }
    const itemsMoved: CanvasItem[] = [
      {
        ...items[0],
        stackPreview: { x: 122, y: 234, rotation: 5 },
      },
    ]
    const k2 = stackFanContentKey(moved, itemsMoved, [moved])
    expect(k1).toBe(k2)
  })

  it('changes when fan membership / relative pose changes', () => {
    const items: CanvasItem[] = [
      {
        id: 'm1',
        type: 'image',
        src: 'blob:x',
        naturalWidth: 10,
        naturalHeight: 10,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        rotation: 0,
        zIndex: 2,
        containerId: 's1',
        stackPreview: { x: 22, y: 34, rotation: 5 },
      },
    ]
    const k1 = stackFanContentKey(stack, items, [stack])
    const items2: CanvasItem[] = [
      {
        ...items[0],
        stackPreview: { x: 50, y: 34, rotation: 5 },
      },
    ]
    const k2 = stackFanContentKey(stack, items2, [stack])
    expect(k1).not.toBe(k2)
  })

  it('changes when crop changes (must rebuild media face)', () => {
    const base = {
      id: 'm1',
      type: 'image' as const,
      src: 'blob:x',
      naturalWidth: 100,
      naturalHeight: 100,
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      rotation: 0,
      zIndex: 2,
      containerId: 's1',
      stackPreview: { x: 22, y: 34, rotation: 0 },
      crop: { x: 0, y: 0, w: 1, h: 1 },
    }
    const items: CanvasItem[] = [base]
    const k1 = stackFanContentKey(stack, items, [stack])
    const items2: CanvasItem[] = [
      { ...base, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
    ]
    const k2 = stackFanContentKey(stack, items2, [stack])
    expect(k1).not.toBe(k2)
  })

  it('is stable for identical inputs', () => {
    const items: CanvasItem[] = [
      {
        id: 'm1',
        type: 'image',
        src: 'blob:x',
        naturalWidth: 10,
        naturalHeight: 10,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        rotation: 0,
        zIndex: 2,
        containerId: 's1',
        stackPreview: { x: 12, y: 14, rotation: 5 },
      },
    ]
    const k1 = stackFanContentKey(stack, items, [stack])
    const k2 = stackFanContentKey(stack, items, [stack])
    expect(k1).toBe(k2)
    expect(stackFanCompositeCacheSize()).toBe(0)
  })

  it('does NOT change when absolute zIndex reflows but relative order stays (select/drag)', () => {
    const items: CanvasItem[] = [
      {
        id: 'a',
        type: 'image',
        src: 'blob:a',
        naturalWidth: 10,
        naturalHeight: 10,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        rotation: 0,
        zIndex: 2,
        containerId: 's1',
        stackPreview: { x: 12, y: 14, rotation: 0 },
      },
      {
        id: 'b',
        type: 'text',
        content: 'hello',
        color: '#1e1e1e',
        backgroundColor: 'transparent',
        fontSize: 16,
        fontFamily: 'system-ui',
        fontWeight: 500,
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        rotation: 0,
        zIndex: 3,
        containerId: 's1',
        stackPreview: { x: 20, y: 18, rotation: 3 },
      },
    ]
    const k1 = stackFanContentKey(stack, items, [stack])
    // Surface reflow assigns denser z (e.g. 10, 11) without changing rank order
    const reflowed: CanvasItem[] = [
      { ...items[0], zIndex: 10 },
      { ...items[1], zIndex: 11 },
    ]
    const k2 = stackFanContentKey(stack, reflowed, [stack])
    expect(k1).toBe(k2)
  })

  it('changes when relative paint order flips', () => {
    const items: CanvasItem[] = [
      {
        id: 'a',
        type: 'image',
        src: 'blob:a',
        naturalWidth: 10,
        naturalHeight: 10,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        rotation: 0,
        zIndex: 2,
        containerId: 's1',
        stackPreview: { x: 12, y: 14, rotation: 0 },
      },
      {
        id: 'b',
        type: 'image',
        src: 'blob:b',
        naturalWidth: 10,
        naturalHeight: 10,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        rotation: 0,
        zIndex: 3,
        containerId: 's1',
        stackPreview: { x: 18, y: 16, rotation: 2 },
      },
    ]
    const k1 = stackFanContentKey(stack, items, [stack])
    const flipped: CanvasItem[] = [
      { ...items[0], zIndex: 5 },
      { ...items[1], zIndex: 4 },
    ]
    const k2 = stackFanContentKey(stack, flipped, [stack])
    expect(k1).not.toBe(k2)
  })
})

describe('sortFanItemsStable', () => {
  it('orders by zIndex then id (matches composite paint)', () => {
    const sorted = sortFanItemsStable([
      { id: 'b', zIndex: 2 },
      { id: 'a', zIndex: 2 },
      { id: 'c', zIndex: 1 },
    ])
    expect(sorted.map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })
})
