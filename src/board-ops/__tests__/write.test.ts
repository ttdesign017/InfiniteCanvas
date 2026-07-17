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

  it('createNote role=title makes large floating text', () => {
    const r = createNote(emptyBoard(), {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      content: 'Songmont',
      role: 'title',
    })
    const item = r.board.items[0] as CanvasItem & {
      type: string
      fontSize: number
      fontWeight: number
    }
    expect(item.type).toBe('text')
    expect(item.fontSize).toBe(64)
    expect(item.fontWeight).toBe(700)
  })

  it('createNote role=keyword and explicit fontSize override', () => {
    const r = createNote(emptyBoard(), {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      content: '皮革',
      role: 'keyword',
      fontSize: 32,
    })
    const item = r.board.items[0] as CanvasItem & {
      type: string
      fontSize: number
    }
    expect(item.type).toBe('text')
    expect(item.fontSize).toBe(32)
  })

  it('createNote rejects out-of-range fontSize', () => {
    expect(() =>
      createNote(emptyBoard(), {
        containerId: ROOT_CONTAINER_ID,
        x: 0,
        y: 0,
        content: 'x',
        fontSize: 999,
      }),
    ).toThrow(BoardOpsError)
  })

  it('createNote auto-sizes CJK body notes taller than short Latin', () => {
    const short = createNote(emptyBoard(), {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      content: 'Hi',
      role: 'body',
    })
    const longCjk = createNote(emptyBoard(), {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      content:
        '宋蒙以极简植鞣革与东方留白著称，产品线覆盖手袋与小皮件，视觉气质克制而不寡淡，材质叙事是核心卖点之一。',
      role: 'body',
    })
    const s = short.board.items[0]
    const l = longCjk.board.items[0]
    expect(l.height).toBeGreaterThan(s.height)
    expect(l.height).toBeGreaterThan(120)
  })

  it('createNote keyword with hex gets that color and fits width', () => {
    const r = createNote(emptyBoard(), {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      content: '#1D1D1B ONYX',
      role: 'keyword',
    })
    const item = r.board.items[0] as CanvasItem & {
      color: string
      width: number
      height: number
      type: string
    }
    expect(item.type).toBe('text')
    expect(item.color.toUpperCase()).toBe('#1D1D1B')
    // single-line preference: short label should not become a multi-line block
    expect(item.height).toBeLessThan(120)
    expect(item.width).toBeGreaterThan(100)
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
