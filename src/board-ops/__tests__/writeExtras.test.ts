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
      // bare link (no annotation) → one link item only
      links: [{ url: 'https://songmont.com' }],
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

  it('addResearchCluster applies title/keyword roles as floating text', () => {
    const r = addResearchCluster(empty(), {
      title: 'Brand',
      notes: [
        { content: 'Songmont', role: 'title' },
        { content: '极简', role: 'keyword' },
        { content: '定位说明段落', role: 'body' },
      ],
      columns: 3,
    })
    const types = r.board.items.map((i) => i.type).sort()
    expect(types.filter((t) => t === 'text')).toHaveLength(2)
    expect(types.filter((t) => t === 'textcard')).toHaveLength(1)
    const title = r.board.items.find(
      (i) => i.type === 'text' && (i as { content: string }).content === 'Songmont',
    ) as { fontSize: number }
    expect(title.fontSize).toBe(64)
  })

  it('addResearchCluster warns when links look like image URLs', () => {
    const r = addResearchCluster(empty(), {
      title: 'X',
      links: [{ url: 'https://cdn.example.com/photo.jpg?w=800' }],
    })
    expect(r.warnings?.some((w) => w.includes('image URL'))).toBe(true)
  })

  it('createLink stays pending so OG preview can fill image/title', () => {
    const r = createLink(empty(), {
      containerId: 'root',
      x: 0,
      y: 0,
      url: 'https://example.com',
      title: 'My Title',
    })
    const link = r.board.items[0] as { title: string; previewStatus?: string }
    expect(link.title).toBe('My Title')
    expect(link.previewStatus).toBe('pending')
  })

  it('createLink lockTitle marks preview complete', () => {
    const r = createLink(empty(), {
      containerId: 'root',
      x: 0,
      y: 0,
      url: 'https://example.com',
      title: 'Locked',
      lockTitle: true,
    })
    const link = r.board.items[0] as { previewStatus?: string }
    expect(link.previewStatus).toBe('complete')
  })

  it('addResearchCluster seeds stackPreview fan and link annotations', () => {
    const r = addResearchCluster(empty(), {
      title: 'Mood',
      layout: 'mood',
      enterStack: true,
      notes: [
        { content: 'Brand', role: 'title' },
        { content: '皮革', role: 'keyword' },
        { content: '定位很长的一段说明文字，用于自动高度', role: 'body' },
      ],
      links: [
        {
          url: 'https://example.com/about',
          annotation: '官网关于页：品牌叙事入口',
        },
      ],
    })
    expect(r.enterContainerId).toBe(r.stackId)
    const stack = r.board.stacks.find((s) => s.id === r.stackId)
    expect(stack?.freeFanRel?.length).toBeGreaterThan(0)
    const members = r.board.items.filter((i) => i.containerId === r.stackId)
    expect(members.every((m) => m.stackPreview)).toBe(true)
    const texts = members.filter((i) => i.type === 'text')
    expect(texts.some((t) => (t as { content: string }).content.includes('官网'))).toBe(
      true,
    )
    const link = members.find((i) => i.type === 'link') as {
      previewStatus?: string
    }
    expect(link.previewStatus).toBe('pending')
  })

  it('cluster clientRequestId reuses stack and appends (progressive)', () => {
    const a = addResearchCluster(empty(), {
      title: 'A',
      clientRequestId: 'stack_fixed_id',
      notes: [{ content: 'n1', role: 'body' }],
    })
    const b = addResearchCluster(a.board, {
      title: 'A again',
      clientRequestId: 'stack_fixed_id',
      notes: [{ content: 'n2', role: 'body' }],
    })
    expect(b.board.stacks).toHaveLength(1)
    expect(b.stackId).toBe('stack_fixed_id')
    expect(b.createdStackIds).toEqual([])
    const inside = listItems(b.board, { containerId: 'stack_fixed_id' })
    expect(inside.total).toBeGreaterThanOrEqual(2)
    expect(b.warnings?.some((w) => /appended/i.test(w))).toBe(true)
  })

  it('stackId append places content below existing items', () => {
    const a = addResearchCluster(empty(), {
      title: 'Board',
      clientRequestId: 'stack_prog',
      notes: [{ content: 'Top', role: 'title' }],
    })
    const top = a.board.items.find((i) => (i as { content?: string }).content === 'Top')!
    const b = addResearchCluster(a.board, {
      stackId: a.stackId,
      sections: [
        {
          heading: 'Next',
          notes: [{ content: 'Below', role: 'body' }],
        },
      ],
    })
    const below = b.board.items.find(
      (i) => (i as { content?: string }).content === 'Below',
    )!
    expect(below.y).toBeGreaterThan(top.y + top.height)
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
