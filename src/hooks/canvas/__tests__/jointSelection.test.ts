import { describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../../types/canvas'
import { captureJointMoveSelection } from '../jointSelection'

const note = (id: string, containerId = ROOT_CONTAINER_ID): CanvasItem => ({
  id,
  type: 'text',
  x: 10,
  y: 20,
  width: 100,
  height: 40,
  rotation: 0,
  zIndex: 1,
  containerId,
  content: id,
  fontSize: 14,
  fontFamily: 'sans-serif',
  fontWeight: 400,
  color: '#111',
  backgroundColor: 'transparent',
})

const stack = (id: string, parentId = ROOT_CONTAINER_ID): StackRecord => ({
  id,
  parentId,
  name: id,
  x: 0,
  y: 0,
  width: 120,
  height: 80,
  zIndex: 2,
})

describe('captureJointMoveSelection', () => {
  it('captures free items and stack folders on the active canvas', () => {
    const items = [note('a'), note('inside', 's1')]
    const stacks = [stack('s1')]
    const result = captureJointMoveSelection({
      items,
      stacks,
      selectedIds: ['a', 'inside'],
      selectedStackIds: ['s1'],
      currentContainerId: ROOT_CONTAINER_ID,
    })
    expect(result.ids).toEqual(['a'])
    expect(result.origins.a).toEqual({ x: 10, y: 20 })
    expect(result.stackIds).toEqual(['s1'])
    expect(result.stackOrigins.s1).toEqual({ x: 0, y: 0 })
  })

  it('ignores stacked fan cards and stacks not on this canvas', () => {
    const items: CanvasItem[] = [
      {
        ...note('fan'),
        stacked: true,
        stackGroupId: 'legacy',
      },
      note('free'),
    ]
    const stacks = [stack('nested', 'parent-elsewhere')]
    const result = captureJointMoveSelection({
      items,
      stacks,
      selectedIds: ['fan', 'free'],
      selectedStackIds: ['nested'],
      currentContainerId: ROOT_CONTAINER_ID,
    })
    expect(result.ids).toEqual(['free'])
    expect(result.stackIds).toEqual([])
  })
})
