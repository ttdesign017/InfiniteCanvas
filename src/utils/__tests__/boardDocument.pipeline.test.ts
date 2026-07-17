import { afterEach, describe, expect, it } from 'vitest'
import type { BoardSnapshot, CanvasItem, StackRecord } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import { revokeAllTrackedBlobUrls } from '../blobUrls'
import {
  loadBoardIntoRuntimeFields,
  packBoardSnapshotToText,
  prepareBoardForRuntime,
  snapshotBoard,
} from '../boardDocument'
import { parseICanvasFile } from '../boardFile'
import { isPlayableMediaSrc } from '../boardFile'
import { stackUnitsAreAtomicOnContainer } from '../zOrder'

const note = (
  id: string,
  z: number,
  containerId = ROOT_CONTAINER_ID,
): CanvasItem => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
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

const stack = (id: string, z: number, parentId = ROOT_CONTAINER_ID): StackRecord => ({
  id,
  parentId,
  name: id,
  x: 0,
  y: 0,
  width: 120,
  height: 100,
  zIndex: z,
})

afterEach(() => {
  revokeAllTrackedBlobUrls()
})

describe('boardDocument pack → open pipeline', () => {
  it('round-trips snapshot through pack text and prepare runtime', async () => {
    const video: CanvasItem = {
      id: 'vid',
      type: 'video',
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      rotation: 0,
      zIndex: 1,
      src: 'data:video/mp4;base64,AAAA',
      fileName: 'clip.mp4',
      naturalWidth: 320,
      naturalHeight: 180,
    }
    const snap = snapshotBoard({
      items: [video, note('n1', 2)],
      stacks: [],
      viewport: { x: 1, y: 2, zoom: 1.5 },
      homeViewport: { x: 1, y: 2, zoom: 1.5 },
      nextZ: 3,
      boardName: 'Pipeline',
      currentContainerId: ROOT_CONTAINER_ID,
    })

    const { text, doc } = await packBoardSnapshotToText(snap)
    expect(doc.items).toHaveLength(2)
    expect(doc.assets.vid || Object.keys(doc.assets).length).toBeTruthy()

    const reopened = parseICanvasFile(text)
    expect(reopened.items).toHaveLength(2)
    expect(reopened.stacks ?? []).toHaveLength(0)

    const ready = prepareBoardForRuntime(reopened)
    expect(ready.boardName).toBe('Pipeline')
    expect(ready.items).toHaveLength(2)
    const vid = ready.items.find((i) => i.id === 'vid') as { src: string }
    expect(isPlayableMediaSrc(vid.src)).toBe(true)
    expect(vid.src.startsWith('blob:') || vid.src.startsWith('data:')).toBe(true)
  })

  it('heals interleaved stack z when loading into runtime fields', () => {
    // Classic interleave: A leaves 2 & 10, B 5–6, free 7
    const board: BoardSnapshot = {
      version: 1,
      name: 'Interleaved',
      viewport: { x: 0, y: 0, zoom: 1 },
      nextZ: 20,
      stacks: [stack('A', 1), stack('B', 4)],
      items: [
        note('a1', 2, 'A'),
        note('a2', 10, 'A'),
        note('b1', 5, 'B'),
        note('b2', 6, 'B'),
        note('free', 7),
      ],
    }
    expect(stackUnitsAreAtomicOnContainer(board.items, board.stacks!)).toBe(
      false,
    )

    const ready = loadBoardIntoRuntimeFields(board)
    expect(
      stackUnitsAreAtomicOnContainer(ready.items, ready.stacks),
    ).toBe(true)
  })
})
