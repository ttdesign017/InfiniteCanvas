import { describe, expect, it } from 'vitest'
import {
  STACK_FAN_EDGE_ALPHA,
  stackFanEdgeOpacityDuringExit,
  stackFanEdgeOpacityForNav,
  stackFanEdgeOpacityIdle,
} from '../stackFanChrome'

describe('stackFanEdgeOpacityDuringExit', () => {
  it('starts at 0 so white edge does not pop at exit begin', () => {
    expect(stackFanEdgeOpacityDuringExit(0)).toBe(0)
  })

  it('is full by ~0.7 gather progress (before handoff)', () => {
    expect(stackFanEdgeOpacityDuringExit(0.7)).toBeCloseTo(
      STACK_FAN_EDGE_ALPHA,
      5,
    )
    expect(stackFanEdgeOpacityDuringExit(1)).toBeCloseTo(
      STACK_FAN_EDGE_ALPHA,
      5,
    )
  })

  it('ramps monotonically', () => {
    let prev = -1
    for (let i = 0; i <= 20; i++) {
      const v = stackFanEdgeOpacityDuringExit(i / 20)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})

describe('stackFanEdgeOpacityForNav', () => {
  it('uses exit ramp only in exit mode', () => {
    expect(stackFanEdgeOpacityForNav('exit', 0)).toBe(0)
    expect(stackFanEdgeOpacityForNav('exit', 1)).toBeCloseTo(
      STACK_FAN_EDGE_ALPHA,
      5,
    )
    expect(stackFanEdgeOpacityForNav('enter', 0)).toBe(STACK_FAN_EDGE_ALPHA)
    expect(stackFanEdgeOpacityForNav(null, 0.2)).toBe(STACK_FAN_EDGE_ALPHA)
    expect(stackFanEdgeOpacityIdle()).toBe(STACK_FAN_EDGE_ALPHA)
  })
})
