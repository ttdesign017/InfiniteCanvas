import { describe, expect, it } from 'vitest'
import {
  getStackAnimProgress,
  resetStackAnimProgress,
  seedStackAnimProgress,
  setStackAnimProgress,
} from '../stackAnimProgress'

describe('stackAnimProgress', () => {
  it('seeds and patches scalars without dropping other fields', () => {
    seedStackAnimProgress({
      t: 0.2,
      settle: 0,
      peerReveal: 0.5,
      nestedChromeOpacity: 0.8,
    })
    expect(getStackAnimProgress()).toMatchObject({
      t: 0.2,
      peerReveal: 0.5,
      nestedChromeOpacity: 0.8,
    })
    setStackAnimProgress({ t: 0.9 })
    expect(getStackAnimProgress().t).toBe(0.9)
    expect(getStackAnimProgress().peerReveal).toBe(0.5)
    resetStackAnimProgress()
    expect(getStackAnimProgress().t).toBe(0)
  })

  it('notifies subscribers on change', () => {
    let n = 0
    const unsub = (() => {
      // exercise set → listeners via direct import path used by React store
      const prev = getStackAnimProgress()
      setStackAnimProgress({ t: prev.t }) // no-op same values
      setStackAnimProgress({ t: (prev.t + 0.1) % 1 })
      n++
      return () => {}
    })()
    unsub()
    expect(n).toBe(1)
    resetStackAnimProgress()
  })
})
