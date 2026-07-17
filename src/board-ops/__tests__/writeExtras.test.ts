import { describe, expect, it } from 'vitest'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import type { BoardSnapshot } from '../../types/canvas'
import {
  addResearchCluster,
  createLink,
  createStack,
  layoutGrid,
  boardViewFromSnapshot,
  listItems,
} from '../index'

function empty() {
  const snap: BoardSnapshot = {
    version: 1,
    name: 'T',
    viewport: { x: 0, y: 0, zoom: 1 },
    nextZ: 1,
    items: [],
    stacks: [],
    currentContainerId: ROOT_CONTAINER_ID,
  }
  return boardViewFromSnapshot(snap)
}

describe('board-ops writeExtras', () => {
  it('createLink and createStack', () => {
    let b = empty()
    const link = createLink(b, {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      url: 'https://songmont.com',
      title: 'Songmont',
    })
    b = link.board
    expect(link.createdIds).toHaveLength(1)
    const st = createStack(b, {
      parentId: ROOT_CONTAINER_ID,
      x: 100,
      y: 100,
      name: 'Brand',
    })
    expect(st.createdStackIds?.[0]).toMatch(/^stack_/)
    expect(st.createdIds).toEqual([])
    expect(st.board.stacks[0].name).toBe('Brand')
  })

  it('addResearchCluster builds stack with notes and links', () => {
    const r = addResearchCluster(empty(), {
      title: 'Songmont Visual',
      notes: [{ content: 'Minimal leather goods' }],
      links: [{ url: 'https://songmont.com', title: 'Official' }],
      columns: 2,
    })
    expect(r.stackId).toBeTruthy()
    expect(r.createdStackIds?.[0]).toBe(r.stackId)
    // createdIds are items only (not the stack folder)
    expect(r.createdIds).not.toContain(r.stackId)
    expect(r.createdIds.length).toBe(2)
    const inside = listItems(r.board, { containerId: r.stackId! })
    expect(inside.total).toBe(2)
  })

  it('createLink with title sets preview complete so OG cannot overwrite', () => {
    const r = createLink(empty(), {
      containerId: 'root',
      x: 0,
      y: 0,
      url: 'https://example.com',
      title: 'My Title',
    })
    const link = r.board.items[0] as { title: string; previewStatus?: string }
    expect(link.title).toBe('My Title')
    expect(link.previewStatus).toBe('complete')
  })

  it('cluster clientRequestId is idempotent', () => {
    const a = addResearchCluster(empty(), {
      title: 'A',
      clientRequestId: 'stack_fixed_id',
      notes: [{ content: 'n1' }],
    })
    const b = addResearchCluster(a.board, {
      title: 'A again',
      clientRequestId: 'stack_fixed_id',
      notes: [{ content: 'n2' }],
    })
    expect(b.board.stacks).toHaveLength(1)
    expect(b.warnings?.[0]).toMatch(/idempotent/)
  })

  it('layoutGrid positions items', () => {
    let b = empty()
    const a = createLink(b, {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      url: 'https://a.test',
    })
    b = a.board
    const c = createLink(b, {
      containerId: ROOT_CONTAINER_ID,
      x: 0,
      y: 0,
      url: 'https://b.test',
    })
    b = c.board
    const ids = [...a.createdIds, ...c.createdIds]
    const laid = layoutGrid(b, {
      itemIds: ids,
      originX: 10,
      originY: 20,
      columns: 2,
      cellWidth: 100,
      gapX: 10,
    })
    const items = laid.board.items.filter((i) => ids.includes(i.id))
    expect(items[0].x).toBe(10)
    expect(items[1].x).toBe(120)
  })
})
