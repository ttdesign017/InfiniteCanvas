/**
 * I10 — nested copy/paste remaps ids and keeps tree shape isomorphic.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import { revokeAllTrackedBlobUrls } from '../../utils/blobUrls'
import { containerOf } from '../../utils/stacks'
import { useCanvasStore } from '../useCanvasStore'

const note = (id: string, containerId: string, z = 1): CanvasItem => ({
  id,
  type: 'text',
  x: 5,
  y: 5,
  width: 80,
  height: 40,
  rotation: 0,
  zIndex: z,
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
  z = 1,
): StackRecord => ({
  id,
  parentId,
  name: id,
  x: 0,
  y: 0,
  width: 120,
  height: 100,
  zIndex: z,
})

describe('nested stack copy / paste (I10)', () => {
  afterEach(() => {
    revokeAllTrackedBlobUrls()
    useCanvasStore.getState().clearClipboard()
  })

  beforeEach(() => {
    useCanvasStore.setState({
      items: [
        note('leaf-b', 'b', 2),
        note('leaf-a', 'a', 3),
        note('root-free', ROOT_CONTAINER_ID, 1),
      ],
      stacks: [stack('a', ROOT_CONTAINER_ID, 4), stack('b', 'a', 5)],
      currentContainerId: ROOT_CONTAINER_ID,
      selectedIds: [],
      selectedStackIds: ['a'],
      nextZ: 10,
      dirty: false,
      history: [],
      future: [],
      animating: false,
      pendingNavigation: null,
      stackEnterAnim: null,
    })
  })

  it('duplicateBodies remaps stack and item ids without sharing source ids', () => {
    const store = useCanvasStore.getState()
    const beforeIds = {
      items: new Set(store.items.map((i) => i.id)),
      stacks: new Set(store.stacks.map((s) => s.id)),
    }

    const result = store.duplicateBodies([], ['a'])
    expect(result.stackIds.length).toBe(1)
    expect(beforeIds.stacks.has(result.stackIds[0])).toBe(false)

    const after = useCanvasStore.getState()
    const newStackId = result.stackIds[0]
    const newTreeStacks = after.stacks.filter(
      (s) => s.id === newStackId || s.parentId === newStackId,
    )
    // A and nested B both cloned
    expect(newTreeStacks.length).toBe(2)

    const newItemIds = after.items
      .filter((i) => !beforeIds.items.has(i.id))
      .map((i) => i.id)
    expect(newItemIds.length).toBeGreaterThanOrEqual(2)

    // No new item may keep a source id
    for (const id of newItemIds) {
      expect(beforeIds.items.has(id)).toBe(false)
    }

    // Nested leaf still lives under a remapped stack, not original 'b'
    const clonedNested = after.stacks.find(
      (s) => s.parentId === newStackId,
    )
    expect(clonedNested).toBeDefined()
    expect(clonedNested!.id).not.toBe('b')
    const nestedLeaves = after.items.filter(
      (i) => containerOf(i) === clonedNested!.id,
    )
    expect(nestedLeaves.length).toBeGreaterThanOrEqual(1)
  })

  it('copy + paste creates a second tree with fresh ids', () => {
    const store = useCanvasStore.getState()
    expect(store.copySelection()).toBe(true)
    const beforeCount = {
      items: store.items.length,
      stacks: store.stacks.length,
    }

    expect(store.pasteClipboard()).toBe(true)
    const after = useCanvasStore.getState()
    expect(after.items.length).toBeGreaterThan(beforeCount.items)
    expect(after.stacks.length).toBeGreaterThan(beforeCount.stacks)

    const allIds = [
      ...after.items.map((i) => i.id),
      ...after.stacks.map((s) => s.id),
    ]
    expect(new Set(allIds).size).toBe(allIds.length)
  })
})
