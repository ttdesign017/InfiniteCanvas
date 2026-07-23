import { describe, expect, it } from 'vitest'
import type { BoardSnapshot, CanvasItem, StackRecord } from '../../types/canvas'
import {
  collectLiveMediaSrcs,
  pruneBoardSnapshotForSave,
} from '../pruneBoardSnapshot'

function img(id: string, containerId?: string, src = `blob:${id}`): CanvasItem {
  return {
    id,
    type: 'image',
    src,
    naturalWidth: 10,
    naturalHeight: 10,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    zIndex: 1,
    containerId,
  }
}

describe('pruneBoardSnapshotForSave', () => {
  it('drops freeFanRel entries for deleted items', () => {
    const stacks: StackRecord[] = [
      {
        id: 's1',
        parentId: 'root',
        name: 'S',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 1,
        freeFanRel: [
          { id: 'alive', dx: 0, dy: 0, rotation: 0 },
          { id: 'deleted-leaf', dx: 1, dy: 1, rotation: 0 },
        ],
      },
    ]
    const snap: BoardSnapshot = {
      version: 1,
      name: 't',
      viewport: { x: 0, y: 0, zoom: 1 },
      items: [img('alive', 's1')],
      nextZ: 2,
      stacks,
    }
    const cleaned = pruneBoardSnapshotForSave(snap)
    expect(cleaned.stacks?.[0].freeFanRel?.map((r) => r.id)).toEqual(['alive'])
    expect(cleaned.items.map((i) => i.id)).toEqual(['alive'])
  })

  it('does not keep items from removed stacks', () => {
    const snap: BoardSnapshot = {
      version: 1,
      name: 't',
      viewport: { x: 0, y: 0, zoom: 1 },
      items: [img('in-orphan', 'missing-stack'), img('root-img')],
      nextZ: 3,
      stacks: [],
    }
    const cleaned = pruneBoardSnapshotForSave(snap)
    expect(cleaned.items.map((i) => i.id)).toEqual(['root-img'])
  })

  it('collectLiveMediaSrcs only lists current media', () => {
    const items: CanvasItem[] = [
      img('a', undefined, 'blob:a'),
      img('b', undefined, 'blob:b'),
      {
        id: 't',
        type: 'text',
        content: 'x',
        fontSize: 12,
        fontFamily: 'sans',
        fontWeight: 400,
        color: '#000',
        backgroundColor: 'transparent',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        zIndex: 1,
      },
    ]
    const srcs = collectLiveMediaSrcs(items)
    expect(srcs.has('blob:a')).toBe(true)
    expect(srcs.has('blob:b')).toBe(true)
    expect(srcs.size).toBe(2)
  })
})
