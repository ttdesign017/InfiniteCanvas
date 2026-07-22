import { describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import {
  collectAlignBodies,
  computeAlignPatches,
  computePackPatches,
} from '../align'

const media = (
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

describe('collectAlignBodies', () => {
  it('builds one body per free selected item', () => {
    const items = [media('a', 0, 0), media('b', 200, 50)]
    const bodies = collectAlignBodies(['a', 'b'], items)
    expect(bodies).toHaveLength(2)
    expect(bodies.map((b) => b.ids[0]).sort()).toEqual(['a', 'b'])
  })

  it('treats a selected stack folder as a single align body', () => {
    const stacks: StackRecord[] = [
      {
        id: 's1',
        parentId: 'root',
        name: 'Folder',
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        zIndex: 2,
      },
    ]
    const items = [
      media('free', 300, 0),
      { ...media('leaf', 0, 0, 40, 40), containerId: 's1' } as CanvasItem,
    ]
    const bodies = collectAlignBodies(['free'], items, {
      stacks,
      selectedStackIds: ['s1'],
    })
    expect(bodies.some((b) => b.stackId === 's1')).toBe(true)
    expect(bodies.some((b) => b.ids.includes('free'))).toBe(true)
  })
})

describe('computeAlignPatches', () => {
  it('aligns left edges of two free items', () => {
    const items = [media('a', 0, 0), media('b', 40, 100)]
    const { itemPatches } = computeAlignPatches(['a', 'b'], items, 'left')
    // Group minX is 0; b moves left by 40
    const b = itemPatches.find((p) => p.id === 'b')
    expect(b).toMatchObject({ id: 'b', dx: -40, dy: 0 })
    // a is already at minX
    expect(itemPatches.find((p) => p.id === 'a')).toBeUndefined()
  })

  it('aligns horizontal centers', () => {
    // a: center x=50, b: center x=250 → group center x=150
    const items = [media('a', 0, 0, 100, 80), media('b', 200, 0, 100, 80)]
    const { itemPatches } = computeAlignPatches(['a', 'b'], items, 'centerH')
    const byId = Object.fromEntries(itemPatches.map((p) => [p.id, p]))
    expect(byId.a.dx).toBeCloseTo(100)
    expect(byId.b.dx).toBeCloseTo(-100)
  })

  it('returns no patches when fewer than two bodies are selected', () => {
    const items = [media('a', 0, 0)]
    expect(computeAlignPatches(['a'], items, 'left')).toEqual({
      itemPatches: [],
      stackPatches: [],
    })
  })
})

describe('computePackPatches', () => {
  it('packs two horizontally gapped items left with a 5px margin', () => {
    // a at 0..100, b at 150..250 → same vertical band; pack left closes gap to 5
    const items = [media('a', 0, 0), media('b', 150, 0)]
    const { itemPatches } = computePackPatches(['a', 'b'], items, 'left')
    const b = itemPatches.find((p) => p.id === 'b')
    // edge after a = 100 + 5 = 105; b.x should become 105 → dx = -45
    expect(b).toMatchObject({ id: 'b', dx: -45, dy: 0 })
  })

  it('packs two vertically gapped items upward with a 5px margin', () => {
    const items = [media('a', 0, 0), media('b', 0, 120)]
    const { itemPatches } = computePackPatches(['a', 'b'], items, 'up')
    const b = itemPatches.find((p) => p.id === 'b')
    // edge after a = 80 + 5 = 85; b.y 120 → dx=0 dy=-35
    expect(b).toMatchObject({ id: 'b', dx: 0, dy: -35 })
  })

  it('falls to the left wall even when Y ranges do not overlap', () => {
    // Column layout: a top-left, b below with no Y overlap — both share wall x=0
    // so b still slides left to the wall (true gravity pack / 聚拢)
    const items = [media('a', 0, 0), media('b', 200, 200)]
    const { itemPatches } = computePackPatches(['a', 'b'], items, 'left')
    const b = itemPatches.find((p) => p.id === 'b')
    expect(b).toMatchObject({ id: 'b', dx: -200, dy: 0 })
  })

  it('packs right to the rightmost wall with margin when rows overlap', () => {
    // a 0..100, b 150..250, wall right = 250; a moves so right edge is at 150-5=145
    const items = [media('a', 0, 0), media('b', 150, 0)]
    const { itemPatches } = computePackPatches(['a', 'b'], items, 'right')
    const a = itemPatches.find((p) => p.id === 'a')
    // targetRight for a = 150 - 5 = 145; targetX = 45; dx = 45
    expect(a).toMatchObject({ id: 'a', dx: 45, dy: 0 })
  })
})
