import { describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import {
  collectDescendantStackIds,
  collectItemsInStackTree,
  containerOf,
  countLeafItemsInStack,
  itemsInContainer,
  stackLabelName,
  stackPath,
} from '../stacks'

const stacks: StackRecord[] = [
  { id: 'a', parentId: 'root', name: 'A', x: 0, y: 0, width: 100, height: 80, zIndex: 1 },
  { id: 'b', parentId: 'a', name: 'B', x: 10, y: 10, width: 80, height: 60, zIndex: 2 },
  { id: 'c', parentId: 'b', name: 'C', x: 5, y: 5, width: 60, height: 40, zIndex: 3 },
]

const note = (id: string, containerId: string): CanvasItem => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  width: 100,
  height: 40,
  rotation: 0,
  zIndex: 1,
  containerId,
  content: id,
  fontSize: 16,
  fontFamily: 'sans-serif',
  fontWeight: 400,
  color: '#111',
  backgroundColor: 'transparent',
})

describe('nested stack traversal', () => {
  it('hides legacy automatic names from compact stack labels', () => {
    expect(stackLabelName('Untitled')).toBe('')
    expect(stackLabelName('Untitled_2')).toBe('')
    expect(stackLabelName('Moodboard')).toBe('Moodboard')
  })

  it('returns an ordered breadcrumb and all descendants', () => {
    expect(stackPath(stacks, 'c').map((stack) => stack.id)).toEqual(['a', 'b', 'c'])
    expect([...collectDescendantStackIds(stacks, 'a')]).toEqual(['a', 'b', 'c'])
  })

  it('counts leaf items across nested child canvases', () => {
    expect(
      countLeafItemsInStack(
        [note('in-a', 'a'), note('in-b', 'b'), note('in-c', 'c'), note('root', 'root')],
        stacks,
        'a',
      ),
    ).toBe(3)
  })

  it('treats missing containerId as the root canvas', () => {
    const orphan = { ...note('no-container', 'root'), containerId: undefined }
    expect(containerOf(orphan)).toBe('root')
  })

  it('lists only items that live on a given canvas container', () => {
    const items = [
      note('in-a', 'a'),
      note('in-b', 'b'),
      note('root', 'root'),
      { ...note('legacy-root', 'root'), containerId: undefined },
    ]
    expect(itemsInContainer(items, 'a').map((i) => i.id)).toEqual(['in-a'])
    expect(itemsInContainer(items, 'root').map((i) => i.id).sort()).toEqual([
      'legacy-root',
      'root',
    ])
  })

  it('collects every item under a nested stack tree', () => {
    const items = [
      note('in-a', 'a'),
      note('in-b', 'b'),
      note('in-c', 'c'),
      note('root', 'root'),
    ]
    expect(collectItemsInStackTree(items, stacks, 'a').map((i) => i.id).sort()).toEqual([
      'in-a',
      'in-b',
      'in-c',
    ])
  })
})
