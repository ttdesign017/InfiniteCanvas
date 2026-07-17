import { describe, expect, it } from 'vitest'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import type { BoardSnapshot, CanvasItem } from '../../types/canvas'
import {
  boardViewFromSnapshot,
  createNote,
  createNotesBatch,
  listItems,
  moveItems,
  updateText,
} from '../index'
import { BoardOpsError } from '../errors'

function emptyBoard() {
  const snap: BoardSnapshot = {
    version: 1,
    name: 'Empty',
    viewport: { x: 0, y: 0, zoom: 1 },
    nextZ: 1,
    items: [],
    stacks: [],
    currentContainerId: ROOT_CONTAINER_ID,
  }
  return boardViewFromSnapshot(snap)
}

describe('board-ops write', () => {
  it('createNote adds a textcard and bumps nextZ', () => {
    const r = createNote(emptyBoard(), {
      containerId: ROOT_CONTAINER_ID,
      x: 10,
      y: 20,
      content: 'Agent note',
    })
    expect(r.createdIds).toHaveLength(1)
    expect(r.dryRun).toBe(false)
    expect(r.board.nextZ).toBe(2)
    const listed = listItems(r.board, { containerId: ROOT_CONTAINER_ID })
    expect(listed.total).toBe(1)
    expect(listed.items[0].label).toContain('Agent note')
  })

  it('createNote dryRun still returns a board preview', () => {
    const r = createNote(
      emptyBoard(),
      { containerId: ROOT_CONTAINER_ID, x: 0, y: 0, content: 'x' },
      { dryRun: true },
    )
    expect(r.dryRun).toBe(true)
    expect(r.board.items).toHaveLength(1)
  })

  it('createNote is idempotent with clientRequestId', () => {
    const first = createNote(emptyBoard(), {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      content: 'once',
      clientRequestId: 'note_fixed',
    })
    const second = createNote(first.board, {
      containerId: ROOT_CONTAINER_ID,
      x: 99,
      y: 99,
      content: 'twice',
      clientRequestId: 'note_fixed',
    })
    expect(second.createdIds).toEqual([])
    expect(second.board.items).toHaveLength(1)
    expect((second.board.items[0] as CanvasItem & { content: string }).content).toBe(
      'once',
    )
  })

  it('createNotesBatch is one logical batch', () => {
    const r = createNotesBatch(emptyBoard(), [
      { containerId: ROOT_CONTAINER_ID, x: 0, y: 0, content: 'a' },
      { containerId: ROOT_CONTAINER_ID, x: 10, y: 0, content: 'b' },
      { containerId: ROOT_CONTAINER_ID, x: 20, y: 0, content: 'c' },
    ])
    expect(r.createdIds).toHaveLength(3)
    expect(r.board.items).toHaveLength(3)
    expect(r.board.nextZ).toBe(4)
  })

  it('updateText patches content only on text kinds', () => {
    const created = createNote(emptyBoard(), {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      content: 'old',
    })
    const id = created.createdIds[0]
    const updated = updateText(created.board, { id, content: 'new' })
    expect(
      (updated.board.items[0] as CanvasItem & { content: string }).content,
    ).toBe('new')
  })

  it('moveItems sets absolute pose', () => {
    const created = createNote(emptyBoard(), {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      content: 'm',
    })
    const id = created.createdIds[0]
    const moved = moveItems(created.board, {
      moves: [{ id, x: 100, y: 200, rotation: 15 }],
    })
    const it = moved.board.items[0]
    expect(it.x).toBe(100)
    expect(it.y).toBe(200)
    expect(it.rotation).toBe(15)
  })

  it('moveItems rejects unknown ids', () => {
    expect(() =>
      moveItems(emptyBoard(), { moves: [{ id: 'nope', x: 1 }] }),
    ).toThrow(BoardOpsError)
  })
})
