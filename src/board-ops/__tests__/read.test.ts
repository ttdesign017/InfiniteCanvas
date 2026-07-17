import { describe, expect, it } from 'vitest'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import type { BoardSnapshot, CanvasItem, StackRecord } from '../../types/canvas'
import {
  boardViewFromSnapshot,
  buildStackTree,
  exportText,
  getBoardMeta,
  getItem,
  listItems,
  searchItems,
} from '../index'
import { BoardOpsError } from '../errors'

const note = (
  id: string,
  z: number,
  content: string,
  containerId = ROOT_CONTAINER_ID,
): CanvasItem => ({
  id,
  type: 'textcard',
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  rotation: 0,
  zIndex: z,
  containerId,
  content,
  fontSize: 14,
  color: '#111',
  backgroundColor: '#fff',
  labelColor: '#888',
  labelBackground: 'transparent',
})

const stack = (
  id: string,
  parentId: string,
  z: number,
  name: string,
): StackRecord => ({
  id,
  parentId,
  name,
  x: 10,
  y: 10,
  width: 120,
  height: 100,
  zIndex: z,
})

function board(): ReturnType<typeof boardViewFromSnapshot> {
  const snap: BoardSnapshot = {
    version: 1,
    name: 'Research',
    viewport: { x: 0, y: 0, zoom: 1 },
    nextZ: 10,
    currentContainerId: ROOT_CONTAINER_ID,
    stacks: [
      stack('A', ROOT_CONTAINER_ID, 1, 'Theme A'),
      stack('B', 'A', 2, 'Nested B'),
    ],
    items: [
      note('n1', 1, 'Hello root'),
      note('n2', 2, 'Inside A', 'A'),
      note('n3', 3, 'Deep note', 'B'),
      {
        id: 'img1',
        type: 'image',
        x: 50,
        y: 50,
        width: 64,
        height: 64,
        rotation: 0,
        zIndex: 4,
        src: 'blob:fake',
        fileName: 'shot.png',
        naturalWidth: 64,
        naturalHeight: 64,
      },
    ],
  }
  return boardViewFromSnapshot(snap)
}

describe('board-ops read', () => {
  it('getBoardMeta returns counts and apiVersion', () => {
    const meta = getBoardMeta(board())
    expect(meta.name).toBe('Research')
    expect(meta.itemCount).toBe(4)
    expect(meta.stackCount).toBe(2)
    expect(meta.apiVersion).toBe(1)
  })

  it('listItems requires explicit container and does not leak media bytes', () => {
    const root = listItems(board(), { containerId: ROOT_CONTAINER_ID })
    expect(root.total).toBe(2)
    expect(root.items.map((i) => i.id).sort()).toEqual(['img1', 'n1'])
    const img = root.items.find((i) => i.id === 'img1')!
    expect(img.media?.hasMedia).toBe(true)
    expect(img.media?.fileName).toBe('shot.png')
    expect(JSON.stringify(img)).not.toMatch(/blob:fake/)

    const inA = listItems(board(), { containerId: 'A' })
    expect(inA.items.map((i) => i.id)).toEqual(['n2'])
  })

  it('listItems throws on missing container', () => {
    expect(() => listItems(board(), { containerId: 'nope' })).toThrow(
      BoardOpsError,
    )
  })

  it('buildStackTree nests children', () => {
    const tree = buildStackTree(board(), { containerId: ROOT_CONTAINER_ID })
    expect(tree.roots).toHaveLength(1)
    expect(tree.roots[0].id).toBe('A')
    expect(tree.roots[0].children[0].id).toBe('B')
    expect(tree.roots[0].itemCount).toBe(1)
  })

  it('exportText collects notes in a container', () => {
    const exp = exportText(board(), { containerId: 'B' })
    expect(exp.blocks).toHaveLength(1)
    expect(exp.blocks[0].text).toContain('Deep note')
    expect(exp.plainText).toContain('Deep note')
  })

  it('getItem returns detail without media src', () => {
    const d = getItem(board(), { id: 'n1' })
    expect(d.content).toBe('Hello root')
    expect(d.type).toBe('textcard')
  })

  it('searchItems finds by content', () => {
    const r = searchItems(board(), { query: 'deep' })
    expect(r.items.map((i) => i.id)).toEqual(['n3'])
  })
})
