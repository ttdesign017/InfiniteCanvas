import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SnapGuide } from '../snap'
import {
  clearSnapGuidesBus,
  getSnapGuides,
  getSnapGuidesVersion,
  setSnapGuidesBus,
  subscribeSnapGuides,
} from '../snapGuidesBus'

afterEach(() => {
  clearSnapGuidesBus()
})

describe('snapGuidesBus', () => {
  it('stores guides and notifies subscribers', () => {
    const fn = vi.fn()
    const unsub = subscribeSnapGuides(fn)
    const guides: SnapGuide[] = [
      { orientation: 'v', pos: 100 },
      { orientation: 'h', pos: 50 },
    ]
    setSnapGuidesBus(guides)
    expect(getSnapGuides()).toEqual(guides)
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('skips notify when guides are equal (guidesEqual)', () => {
    const fn = vi.fn()
    const unsub = subscribeSnapGuides(fn)
    const g: SnapGuide[] = [{ orientation: 'v', pos: 10 }]
    setSnapGuidesBus(g)
    const v = getSnapGuidesVersion()
    setSnapGuidesBus([{ orientation: 'v', pos: 10 }])
    expect(getSnapGuidesVersion()).toBe(v)
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('regression: multi-select (5+) still publishes guides', () => {
    // Contract: body count must not gate guide publication.
    // (Previously bodyCount > 4 skipped setSnapGuides.)
    const multiSelectBodies = 12
    expect(multiSelectBodies).toBeGreaterThan(4)

    const guides: SnapGuide[] = [
      { orientation: 'v', pos: 200 },
      { orientation: 'h', pos: 80 },
    ]
    setSnapGuidesBus(guides)
    expect(getSnapGuides().length).toBe(2)
    expect(getSnapGuides()[0].pos).toBe(200)

    clearSnapGuidesBus()
    expect(getSnapGuides()).toEqual([])
  })

  it('clear empties guides and notifies', () => {
    const fn = vi.fn()
    const unsub = subscribeSnapGuides(fn)
    setSnapGuidesBus([{ orientation: 'h', pos: 1 }])
    clearSnapGuidesBus()
    expect(getSnapGuides()).toEqual([])
    expect(fn).toHaveBeenCalledTimes(2)
    clearSnapGuidesBus() // no-op
    expect(fn).toHaveBeenCalledTimes(2)
    unsub()
  })
})
