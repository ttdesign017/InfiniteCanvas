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
    expect(st.createdIds[0]).toMatch(/^stack_/)
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
    expect(r.createdIds.length).toBeGreaterThanOrEqual(3)
    const inside = listItems(r.board, { containerId: r.stackId! })
    expect(inside.total).toBe(2)
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
