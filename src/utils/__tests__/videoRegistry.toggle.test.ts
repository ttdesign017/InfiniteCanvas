import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerPlaybackToggle,
  togglePlayback,
  togglePlaybacks,
} from '../videoRegistry'

afterEach(() => {
  // Unregister by re-registering nothing — map is module-level; clean via dispose
})

describe('videoRegistry toggle (Space)', () => {
  it('invokes registered toggle so UI can mount decoder + resume', () => {
    const fn = vi.fn()
    const dispose = registerPlaybackToggle('v1', fn)
    expect(togglePlayback('v1')).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
    dispose()
    // After dispose, falls through to DOM (none) → false
    expect(togglePlayback('v1')).toBe(false)
  })

  it('togglePlaybacks hits every id', () => {
    const a = vi.fn()
    const b = vi.fn()
    const d1 = registerPlaybackToggle('a', a)
    const d2 = registerPlaybackToggle('b', b)
    expect(togglePlaybacks(['a', 'b', 'missing'])).toBe(true)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    d1()
    d2()
  })
})
