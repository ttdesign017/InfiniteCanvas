import { describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import {
  findDanglingContainerIds,
  findStackTreeIssues,
  isBoardStructureSound,
} from '../stacks'

const note = (id: string, containerId: string): CanvasItem => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  width: 80,
  height: 40,
  rotation: 0,
  zIndex: 1,
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
  parentId: string,
): StackRecord => ({
  id,
  parentId,
  name: id,
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  zIndex: 1,
})

describe('board structure I1 / I2', () => {
  it('detects dangling containerId that is not root or a stack (I1)', () => {
    const items = [note('a', 'missing-stack'), note('b', ROOT_CONTAINER_ID)]
    const stacks = [stack('real', ROOT_CONTAINER_ID)]
    expect(findDanglingContainerIds(items, stacks)).toEqual(['missing-stack'])
    expect(isBoardStructureSound(items, stacks)).toBe(false)
  })

  it('accepts undefined containerId as root', () => {
    const items = [{ ...note('a', ROOT_CONTAINER_ID), containerId: undefined }]
    expect(findDanglingContainerIds(items, [])).toEqual([])
    expect(isBoardStructureSound(items, [])).toBe(true)
  })

  it('detects parentId cycles among stacks (I2)', () => {
    const stacks = [stack('a', 'b'), stack('b', 'a')]
    const issues = findStackTreeIssues(stacks)
    expect(issues.cycles.sort()).toEqual(['a', 'b'])
    expect(isBoardStructureSound([], stacks)).toBe(false)
  })

  it('detects orphan parentId that is not root or a stack (I2)', () => {
    const stacks = [stack('a', 'ghost-parent')]
    const issues = findStackTreeIssues(stacks)
    expect(issues.orphanParents).toEqual(['a'])
  })

  it('reports sound structure for a healthy nested tree', () => {
    const stacks = [
      stack('a', ROOT_CONTAINER_ID),
      stack('b', 'a'),
    ]
    const items = [note('leaf', 'b'), note('root', ROOT_CONTAINER_ID)]
    expect(findDanglingContainerIds(items, stacks)).toEqual([])
    expect(findStackTreeIssues(stacks)).toEqual({
      cycles: [],
      orphanParents: [],
    })
    expect(isBoardStructureSound(items, stacks)).toBe(true)
  })
})
