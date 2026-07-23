import { afterEach, describe, expect, it } from 'vitest'
import {
  beginDragPose,
  clearDragPosePreview,
  isDragPoseMemberItem,
  isDragPoseMemberStack,
  updateDragPoseDelta,
} from '../dragPosePreview'

/**
 * Contract: dragging a stack moves folder+fan+count as one CSS-var unit.
 * Fan leaf item ids are NOT drag-pose members — only the stack id is.
 * (Prevents double-offset if a fan card also subscribed as an item.)
 */
afterEach(() => {
  clearDragPosePreview()
})

describe('stack unit rigid drag contract', () => {
  it('registers stack id, not fan leaf ids', () => {
    const stackId = 'stack-A'
    const fanLeafIds = ['leaf-1', 'leaf-2', 'leaf-3']
    beginDragPose([], [stackId])
    updateDragPoseDelta(40, -12)

    expect(isDragPoseMemberStack(stackId)).toBe(true)
    for (const id of fanLeafIds) {
      expect(isDragPoseMemberItem(id)).toBe(false)
    }
  })

  it('joint free-item + stack share the same delta bus', () => {
    beginDragPose(['free-img'], ['stack-B'])
    updateDragPoseDelta(8, 8)
    expect(isDragPoseMemberItem('free-img')).toBe(true)
    expect(isDragPoseMemberStack('stack-B')).toBe(true)
  })
})
