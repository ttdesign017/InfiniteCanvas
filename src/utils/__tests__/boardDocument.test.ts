import { afterEach, describe, expect, it } from 'vitest'
import { revokeAllTrackedBlobUrls } from '../blobUrls'
import {
  loadBoardIntoRuntimeFields,
  snapshotBoard,
} from '../boardDocument'
import type { BoardSnapshot } from '../../types/canvas'

describe('boardDocument contract', () => {
  afterEach(() => {
    revokeAllTrackedBlobUrls()
  })

  it('snapshotBoard deep-clones items so packers cannot mutate live state', () => {
    const items = [
      {
        id: 'n1',
        type: 'text' as const,
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        rotation: 0,
        zIndex: 1,
        content: 'hello',
        fontSize: 16,
        fontFamily: 'sans-serif',
        fontWeight: 400,
        color: '#111',
        backgroundColor: 'transparent',
      },
    ]
    const snap = snapshotBoard({
      items,
      stacks: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      homeViewport: { x: 0, y: 0, zoom: 1 },
      nextZ: 2,
      boardName: 'Test',
      currentContainerId: 'root',
    })
    snap.items[0] = { ...snap.items[0], content: 'mutated' } as (typeof items)[0]
    expect(items[0].content).toBe('hello')
    expect(snap.name).toBe('Test')
  })

  it('loadBoardIntoRuntimeFields hydrates video data: to blob: for playback', () => {
    const board: BoardSnapshot = {
      version: 1,
      name: 'Media',
      viewport: { x: 0, y: 0, zoom: 1 },
      nextZ: 2,
      stacks: [],
      items: [
        {
          id: 'v1',
          type: 'video',
          x: 0,
          y: 0,
          width: 320,
          height: 180,
          rotation: 0,
          zIndex: 1,
          src: 'data:video/mp4;base64,AAAA',
          fileName: 'a.mp4',
          naturalWidth: 320,
          naturalHeight: 180,
        },
      ],
    }
    const ready = loadBoardIntoRuntimeFields(board)
    expect(ready.items).toHaveLength(1)
    expect((ready.items[0] as { src: string }).src).toMatch(/^blob:/)
  })
})
