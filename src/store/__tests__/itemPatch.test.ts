import { describe, expect, it } from 'vitest'
import type { CanvasItem } from '../../types/canvas'
import { applyItemPatch, applyItemPatches } from '../itemPatch'

const note = (id: string, content: string): CanvasItem => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  width: 100,
  height: 40,
  rotation: 0,
  zIndex: 1,
  content,
  fontSize: 16,
  fontFamily: 'sans-serif',
  fontWeight: 400,
  color: '#111',
  backgroundColor: 'transparent',
})

describe('applyItemPatch', () => {
  it('returns the same array reference when id is missing', () => {
    const items = [note('a', 'hi')]
    const next = applyItemPatch(items, 'missing', { content: 'x' })
    expect(next).toBe(items)
  })

  it('returns a new array and merges the patch when id exists', () => {
    const items = [note('a', 'hi'), note('b', 'yo')]
    const next = applyItemPatch(items, 'a', { content: 'edited', x: 10 })
    expect(next).not.toBe(items)
    expect(next[0]).toMatchObject({ id: 'a', content: 'edited', x: 10 })
    expect(next[1]).toBe(items[1])
    expect((items[0] as { content: string }).content).toBe('hi')
  })
})

describe('applyItemPatches', () => {
  it('no-ops on empty patch list', () => {
    const items = [note('a', 'hi')]
    expect(applyItemPatches(items, [])).toBe(items)
  })

  it('last patch wins when the same id appears twice', () => {
    const items = [note('a', 'hi')]
    const next = applyItemPatches(items, [
      { id: 'a', patch: { content: 'first' } },
      { id: 'a', patch: { content: 'second' } },
    ])
    expect(next[0]).toMatchObject({ content: 'second' })
  })

  it('applies multiple ids in one pass', () => {
    const items = [note('a', 'a'), note('b', 'b')]
    const next = applyItemPatches(items, [
      { id: 'a', patch: { content: 'A' } },
      { id: 'b', patch: { content: 'B' } },
    ])
    expect(next.map((i) => (i as { content: string }).content)).toEqual([
      'A',
      'B',
    ])
  })
})
