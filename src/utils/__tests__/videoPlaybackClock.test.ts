import { afterEach, describe, expect, it } from 'vitest'
import {
  clearAllRememberedPlaybackTimes,
  clearRememberedPlaybackTime,
  getRememberedPlaybackTime,
  preferredSnapshotTime,
  rememberPlaybackTime,
  resolveResumeTime,
} from '../videoPlaybackClock'

afterEach(() => {
  clearAllRememberedPlaybackTimes()
})

describe('videoPlaybackClock', () => {
  it('stores and reads last playback time per id', () => {
    rememberPlaybackTime('v1', 12.5)
    rememberPlaybackTime('v2', 3)
    expect(getRememberedPlaybackTime('v1')).toBe(12.5)
    expect(getRememberedPlaybackTime('v2')).toBe(3)
    expect(getRememberedPlaybackTime('missing')).toBe(0)
  })

  it('ignores invalid times', () => {
    rememberPlaybackTime('v1', 5)
    rememberPlaybackTime('v1', Number.NaN)
    rememberPlaybackTime('v1', -1)
    expect(getRememberedPlaybackTime('v1')).toBe(5)
  })

  it('clears per id and all', () => {
    rememberPlaybackTime('v1', 1)
    rememberPlaybackTime('v2', 2)
    clearRememberedPlaybackTime('v1')
    expect(getRememberedPlaybackTime('v1')).toBe(0)
    expect(getRememberedPlaybackTime('v2')).toBe(2)
    clearAllRememberedPlaybackTimes()
    expect(getRememberedPlaybackTime('v2')).toBe(0)
  })

  describe('resolveResumeTime (Space resume)', () => {
    it('returns remembered mid-roll position so pause/play continues', () => {
      expect(resolveResumeTime(8.25, 60)).toBe(8.25)
    })

    it('restarts from 0 when remembered time is at end of clip', () => {
      expect(resolveResumeTime(59.98, 60)).toBe(0)
      expect(resolveResumeTime(60, 60)).toBe(0)
    })

    it('clamps invalid remembered values to 0', () => {
      expect(resolveResumeTime(Number.NaN, 10)).toBe(0)
      expect(resolveResumeTime(-3, 10)).toBe(0)
    })

    it('keeps time when duration is unknown', () => {
      expect(resolveResumeTime(4.2)).toBe(4.2)
    })
  })

  describe('preferredSnapshotTime (Shift+C idle)', () => {
    it('uses remembered time when user has played past start', () => {
      expect(preferredSnapshotTime(7.5, 100)).toBe(7.5)
    })

    it('nudges past t=0 when never played (avoid pure black frame)', () => {
      const t = preferredSnapshotTime(0, 10)
      expect(t).toBeGreaterThan(0)
      expect(t).toBeLessThanOrEqual(0.15)
    })

    it('clamps remembered time to duration', () => {
      expect(preferredSnapshotTime(999, 5)).toBeCloseTo(4.999, 3)
    })
  })
})

/**
 * Regression contract: idle still + unmount decoder must not lose resume clock.
 * Documented as the Space-after-pause bug (restart from 0).
 */
describe('regression: space resume clock', () => {
  it('pause at t then remount resume uses same t (not 0)', () => {
    const id = 'vid-space'
    // Simulate timeupdate while playing
    rememberPlaybackTime(id, 0)
    rememberPlaybackTime(id, 3.14)
    // Pause unmounts live video — clock must survive
    const afterUnmount = getRememberedPlaybackTime(id)
    expect(resolveResumeTime(afterUnmount, 120)).toBe(3.14)
    // Second Space: still same clock until time advances
    expect(resolveResumeTime(getRememberedPlaybackTime(id), 120)).toBe(3.14)
  })
})
