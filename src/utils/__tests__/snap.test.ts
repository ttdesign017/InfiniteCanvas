import { describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import { collectSnapBodies, computeSnapDelta } from '../snap'

const box = (
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 80,
): CanvasItem =>
  ({
    id,
    type: 'image',
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex: 1,
    src: 'data:image/png;base64,AQID',
    naturalWidth: width,
    naturalHeight: height,
  }) as CanvasItem

describe('snap targets', () => {
  it('collects free items on the active canvas as snap bodies', () => {
    const items = [
      box('a', 0, 0),
      box('b', 200, 0),
      {
        ...box('inside', 10, 10),
        containerId: 'stack-a',
      } as CanvasItem,
    ]
    const bodies = collectSnapBodies(items, new Set(['a']), {
      containerId: 'root',
    })
    // Moving "a" is excluded; root free "b" remains; nested "inside" is not a parent target
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ x: 200, y: 0, width: 100, height: 80 })
  })

  it('treats an enterable stack folder as one snap body on its parent', () => {
    const stacks: StackRecord[] = [
      {
        id: 'stack-a',
        parentId: 'root',
        name: 'A',
        x: 50,
        y: 40,
        width: 120,
        height: 90,
        zIndex: 2,
      },
    ]
    const items = [
      box('free', 300, 0),
      {
        ...box('leaf', 0, 0, 40, 40),
        containerId: 'stack-a',
      } as CanvasItem,
    ]
    const bodies = collectSnapBodies(items, new Set(), {
      stacks,
      containerId: 'root',
    })
    // free item + one stack body
    expect(bodies.length).toBe(2)
    expect(bodies.some((b) => b.x === 300 && b.y === 0)).toBe(true)
  })
})

describe('computeSnapDelta', () => {
  it('snaps a moving box left edge to a nearby target left edge', () => {
    const target = box('t', 100, 0)
    // Moving box almost aligned: left edge at 102 → should snap by dx=-2 within threshold 10
    const moving = [box('m', 102, 5)]
    const result = computeSnapDelta(moving, [target, ...moving], 10)
    expect(result.dx).toBeCloseTo(-2)
    expect(result.guides.some((g) => g.orientation === 'v' && g.pos === 100)).toBe(
      true,
    )
  })

  it('does not snap when every edge is farther than the threshold', () => {
    const target = box('t', 0, 0)
    // Far in both axes so no edge/midline is within threshold 10
    const far = [box('m', 200, 200)]
    const result = computeSnapDelta(far, [target, ...far], 10)
    expect(result.dx).toBe(0)
    expect(result.dy).toBe(0)
    expect(result.guides).toEqual([])
  })

  it('returns zero delta when nothing is moving', () => {
    expect(computeSnapDelta([], [box('t', 0, 0)], 10)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    })
  })
})
