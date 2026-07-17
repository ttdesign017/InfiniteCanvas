/**
 * Board-runtime invariants: opening a board or undoing must never leave the
 * canvas interaction-locked, and automatic patches must not dirty a clean board.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BoardSnapshot, CanvasItem, MediaItem } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import { revokeAllTrackedBlobUrls } from '../../utils/blobUrls'
import { isPlayableMediaSrc } from '../../utils/boardFile'
import { stackUnitsAreAtomicOnContainer } from '../../utils/zOrder'
import { useCanvasStore } from '../useCanvasStore'

const note = (id: string, content = id): CanvasItem => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  width: 120,
  height: 40,
  rotation: 0,
  zIndex: 1,
  containerId: ROOT_CONTAINER_ID,
  content,
  fontSize: 16,
  fontFamily: 'sans-serif',
  fontWeight: 400,
  color: '#111',
  backgroundColor: 'transparent',
})

const emptyBoard = (name: string): BoardSnapshot => ({
  version: 1,
  name,
  viewport: { x: 0, y: 0, zoom: 1 },
  items: [note('imported-note', 'from file')],
  nextZ: 2,
  stacks: [],
})

describe('importBoard runtime locks', () => {
  afterEach(() => {
    revokeAllTrackedBlobUrls()
  })

  beforeEach(() => {
    useCanvasStore.setState({
      items: [note('old')],
      stacks: [],
      currentContainerId: ROOT_CONTAINER_ID,
      selectedIds: ['old'],
      selectedStackIds: [],
      editingId: 'old',
      editingStackGroupId: null,
      animating: true,
      stackEnterAnim: {
        stackId: 'ghost',
        mode: 'exit',
        start: { x: 0, y: 0, w: 10, h: 10 },
        t: 0.5,
      },
      pendingNavigation: 'some-stack',
      history: [
        {
          items: [note('hist')],
          stacks: [],
          nextZ: 1,
          currentContainerId: ROOT_CONTAINER_ID,
        },
      ],
      future: [],
      dirty: true,
      boardName: 'Dirty board',
      nextZ: 3,
    })
  })

  it('clears animation and navigation locks when a board is opened', () => {
    useCanvasStore.getState().importBoard(emptyBoard('Opened'))

    const s = useCanvasStore.getState()
    expect(s.animating).toBe(false)
    expect(s.pendingNavigation).toBeNull()
    expect(s.stackEnterAnim).toBeNull()
    expect(s.history).toEqual([])
    expect(s.future).toEqual([])
    expect(s.dirty).toBe(false)
    expect(s.selectedIds).toEqual([])
    expect(s.editingId).toBeNull()
    expect(s.boardName).toBe('Opened')
    expect(s.items).toHaveLength(1)
    expect(s.items[0].id).toBe('imported-note')
  })

  it('importBoard reflows interleaved stack z so folder+fan stay atomic', () => {
    const mk = (
      id: string,
      z: number,
      containerId: string,
    ): CanvasItem => ({
      ...note(id),
      zIndex: z,
      containerId,
    })
    const board: BoardSnapshot = {
      version: 1,
      name: 'Z mess',
      viewport: { x: 0, y: 0, zoom: 1 },
      nextZ: 20,
      stacks: [
        {
          id: 'A',
          parentId: ROOT_CONTAINER_ID,
          name: 'A',
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          zIndex: 1,
        },
        {
          id: 'B',
          parentId: ROOT_CONTAINER_ID,
          name: 'B',
          x: 50,
          y: 50,
          width: 100,
          height: 80,
          zIndex: 4,
        },
      ],
      items: [
        mk('a1', 2, 'A'),
        mk('a2', 10, 'A'),
        mk('b1', 5, 'B'),
        mk('b2', 6, 'B'),
        mk('free', 7, ROOT_CONTAINER_ID),
      ],
    }

    expect(stackUnitsAreAtomicOnContainer(board.items, board.stacks!)).toBe(
      false,
    )
    useCanvasStore.getState().importBoard(board)
    const s = useCanvasStore.getState()
    expect(stackUnitsAreAtomicOnContainer(s.items, s.stacks)).toBe(true)
  })

  it('hydrates packed data: media into blob: URLs so video can display after open', () => {
    const mediaBoard: BoardSnapshot = {
      version: 1,
      name: 'Media board',
      viewport: { x: 0, y: 0, zoom: 1 },
      nextZ: 5,
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
        {
          id: 'a1',
          type: 'audio',
          x: 0,
          y: 200,
          width: 324,
          height: 84,
          rotation: 0,
          zIndex: 2,
          src: 'data:audio/mpeg;base64,AQID',
          fileName: 'a.mp3',
        },
        {
          id: 'i1',
          type: 'image',
          x: 0,
          y: 300,
          width: 100,
          height: 100,
          rotation: 0,
          zIndex: 3,
          src: 'data:image/png;base64,AQID',
          fileName: 'a.png',
          naturalWidth: 100,
          naturalHeight: 100,
        },
      ],
    }

    useCanvasStore.getState().importBoard(mediaBoard)
    const items = useCanvasStore.getState().items
    expect(items).toHaveLength(3)
    for (const item of items) {
      const src = (item as MediaItem).src
      expect(src.startsWith('blob:')).toBe(true)
      expect(isPlayableMediaSrc(src)).toBe(true)
    }
  })
})

describe('dirty flag contract', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      items: [note('n1', 'hello')],
      stacks: [],
      dirty: false,
      history: [],
      future: [],
      animating: false,
      pendingNavigation: null,
      stackEnterAnim: null,
    })
  })

  it('does not mark the board dirty for automatic metadata patches', () => {
    useCanvasStore.getState().updateItem('n1', { content: 'auto preview' }, { dirty: false })

    const s = useCanvasStore.getState()
    expect(s.dirty).toBe(false)
    expect(s.items[0]).toMatchObject({ id: 'n1', content: 'auto preview' })
  })

  it('marks the board dirty for normal user edits', () => {
    useCanvasStore.getState().updateItem('n1', { content: 'typed by user' })

    const s = useCanvasStore.getState()
    expect(s.dirty).toBe(true)
    expect(s.items[0]).toMatchObject({ content: 'typed by user' })
  })
})

describe('undo / redo clear navigation locks', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      items: [note('live', 'after')],
      stacks: [],
      currentContainerId: ROOT_CONTAINER_ID,
      nextZ: 2,
      dirty: false,
      history: [],
      future: [],
      animating: false,
      pendingNavigation: null,
      stackEnterAnim: null,
      selectedIds: [],
      selectedStackIds: [],
      editingId: null,
      editingStackGroupId: null,
    })
  })

  it('clears animating and pendingNavigation on undo', () => {
    const store = useCanvasStore.getState()
    store.pushHistory()
    useCanvasStore.setState({
      items: [note('live', 'changed')],
      animating: true,
      pendingNavigation: 'stack-x',
      stackEnterAnim: {
        stackId: 'stack-x',
        mode: 'enter',
        start: { x: 0, y: 0, w: 20, h: 20 },
        t: 0.2,
      },
    })

    useCanvasStore.getState().undo()

    const s = useCanvasStore.getState()
    expect(s.animating).toBe(false)
    expect(s.pendingNavigation).toBeNull()
    expect(s.stackEnterAnim).toBeNull()
    expect(s.items[0]).toMatchObject({ content: 'after' })
  })

  it('clears animating and pendingNavigation on redo', () => {
    const store = useCanvasStore.getState()
    store.pushHistory()
    useCanvasStore.setState({ items: [note('live', 'changed')] })
    useCanvasStore.getState().undo()

    useCanvasStore.setState({
      animating: true,
      pendingNavigation: 'stack-y',
    })
    useCanvasStore.getState().redo()

    const s = useCanvasStore.getState()
    expect(s.animating).toBe(false)
    expect(s.pendingNavigation).toBeNull()
    expect(s.items[0]).toMatchObject({ content: 'changed' })
  })
})
