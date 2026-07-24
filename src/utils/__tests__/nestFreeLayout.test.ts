import { describe, expect, it } from 'vitest'
import { STACK_FOLDER_PAD } from '../layout'
import {
  buildNestFreePoses,
  computeFreeLayoutOrigin,
  freePoseFromPreStack,
} from '../nestFreeLayout'

describe('nestFreeLayout', () => {
  it('computeFreeLayoutOrigin uses min x/y of free poses', () => {
    expect(
      computeFreeLayoutOrigin([
        { x: 100, y: 200 },
        { x: 280, y: 240 },
        { x: 140, y: 360 },
      ]),
    ).toEqual({ originX: 100, originY: 200 })
  })

  it('computeFreeLayoutOrigin is zero for empty input', () => {
    expect(computeFreeLayoutOrigin([])).toEqual({ originX: 0, originY: 0 })
  })

  it('freePoseFromPreStack preserves relative layout and rotation with pad', () => {
    const origin = { originX: 100, originY: 200 }
    const a = freePoseFromPreStack(
      { x: 100, y: 200, rotation: 0 },
      origin,
      STACK_FOLDER_PAD,
    )
    const b = freePoseFromPreStack(
      { x: 280, y: 240, rotation: 12 },
      origin,
      STACK_FOLDER_PAD,
    )
    expect(a).toEqual({
      x: STACK_FOLDER_PAD,
      y: STACK_FOLDER_PAD,
      rotation: 0,
    })
    expect(b.x - a.x).toBe(180)
    expect(b.y - a.y).toBe(40)
    expect(b.rotation).toBe(12)
  })

  it('buildNestFreePoses maps all members with start entries', () => {
    const startMap = new Map([
      ['a', { x: 100, y: 200, rotation: 0 }],
      ['b', { x: 280, y: 240, rotation: -3 }],
      ['c', { x: 140, y: 360, rotation: 5 }],
    ])
    const poses = buildNestFreePoses(['a', 'b', 'c'], startMap)
    expect(poses.get('a')).toEqual({
      x: STACK_FOLDER_PAD,
      y: STACK_FOLDER_PAD,
      rotation: 0,
    })
    expect(poses.get('b')!.x - poses.get('a')!.x).toBe(180)
    expect(poses.get('c')!.rotation).toBe(5)
  })

  it('buildNestFreePoses omits ids missing from startMap (no fan fallback)', () => {
    const startMap = new Map([['a', { x: 10, y: 20, rotation: 0 }]])
    const poses = buildNestFreePoses(['a', 'ghost'], startMap)
    expect(poses.has('a')).toBe(true)
    expect(poses.has('ghost')).toBe(false)
  })
})
