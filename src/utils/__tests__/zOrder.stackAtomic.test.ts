import { describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import {
  findStackUnitInterleaving,
  nestedStackUnitMaxZ,
  nestedStackUnitMinZ,
  reflowContainerSurfaceZ,
  raiseSelectionZ,
  stackFolderPaintZ,
  stackUnitsAreAtomicOnContainer,
} from '../zOrder'

const note = (
  id: string,
  zIndex: number,
  containerId = ROOT_CONTAINER_ID,
): CanvasItem => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  width: 80,
  height: 40,
  rotation: 0,
  zIndex,
  containerId,
  content: id,
  fontSize: 14,
  fontFamily: 'sans-serif',
  fontWeight: 400,
  color: '#111',
  backgroundColor: 'transparent',
})

const stack = (
  id: string,
  zIndex: number,
  parentId = ROOT_CONTAINER_ID,
): StackRecord => ({
  id,
  parentId,
  name: id,
  x: 0,
  y: 0,
  width: 120,
  height: 100,
  zIndex,
})

/**
 * Classic interleave bug:
 *   stack A folder under z≈1, leaf A1=2, leaf A2=10
 *   stack B folder under z≈4, leaves 5–6
 *   free note at z=7
 * CSS order paints B's fan (and free notes) between A's folder and A's top card.
 */
function interleavedFixture() {
  const stacks = [stack('A', 1), stack('B', 4)]
  const items = [
    note('a1', 2, 'A'),
    note('a2', 10, 'A'),
    note('b1', 5, 'B'),
    note('b2', 6, 'B'),
    note('free', 7, ROOT_CONTAINER_ID),
  ]
  return { stacks, items }
}

describe('stack unit atomicity (folder + fan)', () => {
  it('detects when another stack sits inside a stack unit z-range', () => {
    const { items, stacks } = interleavedFixture()
    expect(stackUnitsAreAtomicOnContainer(items, stacks)).toBe(false)
    const hits = findStackUnitInterleaving(items, stacks)
    expect(hits.some((h) => h.stackId === 'A' && h.foreign.kind === 'stack')).toBe(
      true,
    )
    expect(
      hits.some(
        (h) =>
          h.stackId === 'A' &&
          h.foreign.kind === 'item' &&
          h.foreign.id === 'free',
      ),
    ).toBe(true)
  })

  it('reflow makes every stack unit an exclusive contiguous block', () => {
    const { items, stacks } = interleavedFixture()
    const { itemZMap, stackZMap } = reflowContainerSurfaceZ(
      items,
      stacks,
      ROOT_CONTAINER_ID,
    )

    const nextItems = items.map((i) =>
      itemZMap.has(i.id) ? { ...i, zIndex: itemZMap.get(i.id)! } : i,
    )
    const nextStacks = stacks.map((s) =>
      stackZMap.has(s.id) ? { ...s, zIndex: stackZMap.get(s.id)! } : s,
    )

    expect(stackUnitsAreAtomicOnContainer(nextItems, nextStacks)).toBe(true)
    expect(findStackUnitInterleaving(nextItems, nextStacks)).toEqual([])

    // Each stack: folder z strictly under all its leaves; no gaps for foreigners
    for (const st of nextStacks) {
      const lo = nestedStackUnitMinZ(st, nextItems, nextStacks)
      const hi = nestedStackUnitMaxZ(st, nextItems, nextStacks)
      expect(stackFolderPaintZ(st, nextItems, nextStacks)).toBe(st.zIndex)
      expect(st.zIndex).toBe(lo)
      const leaves = nextItems.filter((i) => i.containerId === st.id)
      for (const leaf of leaves) {
        expect(leaf.zIndex).toBeGreaterThan(st.zIndex)
        expect(leaf.zIndex).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('raiseSelectionZ reflows the whole surface so unselected stacks stay atomic', () => {
    const { items, stacks } = interleavedFixture()
    // Only select free note — previously this raised free z without healing stacks
    const { itemZMap, stackZMap } = raiseSelectionZ(
      items,
      stacks,
      ['free'],
      [],
      100,
      { containerId: ROOT_CONTAINER_ID, promoteFreeId: 'free' },
    )
    const nextItems = items.map((i) =>
      itemZMap.has(i.id) ? { ...i, zIndex: itemZMap.get(i.id)! } : i,
    )
    const nextStacks = stacks.map((s) =>
      stackZMap.has(s.id) ? { ...s, zIndex: stackZMap.get(s.id)! } : s,
    )

    expect(stackUnitsAreAtomicOnContainer(nextItems, nextStacks)).toBe(true)
    // Free note ends up above both stack units
    const freeZ = nextItems.find((i) => i.id === 'free')!.zIndex
    for (const st of nextStacks) {
      expect(freeZ).toBeGreaterThan(nestedStackUnitMaxZ(st, nextItems, nextStacks))
    }
  })

  it('keeps two healthy stacks atomic after reflow with stable relative order', () => {
    const stacks = [stack('A', 1), stack('B', 10)]
    const items = [
      note('a1', 2, 'A'),
      note('a2', 3, 'A'),
      note('b1', 11, 'B'),
      note('b2', 12, 'B'),
      note('free', 5, ROOT_CONTAINER_ID),
    ]
    // free@5 sits between A and B ranges? A is 1-3, free 5, B 10-12 — atomic already
    expect(stackUnitsAreAtomicOnContainer(items, stacks)).toBe(true)

    const { itemZMap, stackZMap } = reflowContainerSurfaceZ(
      items,
      stacks,
      ROOT_CONTAINER_ID,
    )
    const nextItems = items.map((i) =>
      itemZMap.has(i.id) ? { ...i, zIndex: itemZMap.get(i.id)! } : i,
    )
    const nextStacks = stacks.map((s) =>
      stackZMap.has(s.id) ? { ...s, zIndex: stackZMap.get(s.id)! } : s,
    )
    expect(stackUnitsAreAtomicOnContainer(nextItems, nextStacks)).toBe(true)

    const maxA = nestedStackUnitMaxZ(
      nextStacks.find((s) => s.id === 'A')!,
      nextItems,
      nextStacks,
    )
    const minB = nestedStackUnitMinZ(
      nextStacks.find((s) => s.id === 'B')!,
      nextItems,
      nextStacks,
    )
    // A was behind B (minZ 1 < 10); after reflow A block still before B block
    // (free may sit between or after depending on sort — free minZ=5 between)
    expect(maxA).toBeLessThan(minB)
  })
})
