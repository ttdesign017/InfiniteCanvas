import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginDragPose,
  clearDragPosePreview,
  getDragPoseDelta,
  getDragPoseVersion,
  isDragPoseActive,
  isDragPoseMemberItem,
  setDragPosePreview,
  subscribeDragPose,
  updateDragPoseDelta,
  bindDragPoseHost,
} from '../dragPosePreview'

afterEach(() => {
  clearDragPosePreview()
  bindDragPoseHost(null)
})

describe('dragPosePreview (CSS-var / pan-like model)', () => {
  it('begin notifies once; updateDragPoseDelta does not notify', () => {
    const fn = vi.fn()
    const unsub = subscribeDragPose(fn)
    const host = {
      style: { setProperty: vi.fn() },
    } as unknown as HTMLElement
    bindDragPoseHost(host)

    beginDragPose(['a', 'b'], [])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(isDragPoseMemberItem('a')).toBe(true)
    expect(isDragPoseActive()).toBe(true)
    const vAfterBegin = getDragPoseVersion()

    updateDragPoseDelta(10, 20)
    updateDragPoseDelta(15, 25)
    // Hot path: no React notify
    expect(fn).toHaveBeenCalledTimes(1)
    expect(getDragPoseVersion()).toBe(vAfterBegin)
    expect(getDragPoseDelta()).toEqual({ dx: 15, dy: 25 })
    expect(host.style.setProperty).toHaveBeenCalledWith('--drag-dx', '15px')
    expect(host.style.setProperty).toHaveBeenCalledWith('--drag-dy', '25px')

    clearDragPosePreview()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(isDragPoseActive()).toBe(false)
    unsub()
  })

  it('non-members stay false so they never re-render for drag delta', () => {
    beginDragPose(['a'])
    expect(isDragPoseMemberItem('a')).toBe(true)
    expect(isDragPoseMemberItem('other')).toBe(false)
  })

  it('regression: 35-id multi-drag is expressible as one CSS var write', () => {
    const ids = Array.from({ length: 35 }, (_, i) => `img-${i}`)
    const host = {
      style: { setProperty: vi.fn() },
    } as unknown as HTMLElement
    bindDragPoseHost(host)
    beginDragPose(ids)
    for (let i = 0; i < 60; i++) {
      updateDragPoseDelta(i, -i)
    }
    // Only last write matters for compositor; membership unchanged
    expect(isDragPoseMemberItem('img-0')).toBe(true)
    expect(isDragPoseMemberItem('img-34')).toBe(true)
    expect(host.style.setProperty).toHaveBeenCalledWith('--drag-dx', '59px')
  })

  it('setDragPosePreview still works (compat)', () => {
    setDragPosePreview(3, 4, ['x'])
    expect(isDragPoseMemberItem('x')).toBe(true)
    expect(getDragPoseDelta()).toEqual({ dx: 3, dy: 4 })
  })
})
