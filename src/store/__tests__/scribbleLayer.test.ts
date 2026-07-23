import { beforeEach, describe, expect, it } from 'vitest'
import { useCanvasStore } from '../useCanvasStore'

function resetStore() {
  useCanvasStore.setState({
    items: [],
    stacks: [],
    selectedIds: [],
    selectedStackIds: [],
    tool: 'select',
    activeScribbleId: null,
    nextZ: 1,
    history: [],
    future: [],
    dirty: false,
    animating: false,
  })
}

describe('scribble layer session', () => {
  beforeEach(() => {
    resetStore()
  })

  it('keeps multiple strokes in one item while the session is open', () => {
    const store = useCanvasStore.getState()
    store.setTool('scribble')

    const id1 = store.startScribble({ x: 100, y: 100 })
    store.appendScribblePoint(id1, { x: 120, y: 110 })
    store.endScribble()

    const id2 = useCanvasStore.getState().startScribble({ x: 140, y: 130 })
    useCanvasStore.getState().appendScribblePoint(id2, { x: 160, y: 150 })
    useCanvasStore.getState().endScribble()

    const s = useCanvasStore.getState()
    expect(id1).toBe(id2)
    expect(s.activeScribbleId).toBe(id1)
    expect(s.items.filter((i) => i.type === 'scribble')).toHaveLength(1)
    const scribble = s.items.find((i) => i.id === id1)
    expect(scribble?.type).toBe('scribble')
    if (scribble?.type === 'scribble') {
      expect(scribble.paths.length).toBe(2)
    }
  })

  it('appends a pointer batch in one store update and normalizes on pointer up', () => {
    const store = useCanvasStore.getState()
    store.setTool('scribble')
    const id = store.startScribble({ x: 100, y: 100 })
    store.appendScribblePoints(id, [
      { x: 80, y: 90 },
      { x: 140, y: 130 },
    ])

    const live = useCanvasStore.getState().items.find((item) => item.id === id)
    expect(live?.type === 'scribble' && live.paths[0].points).toHaveLength(3)
    useCanvasStore.getState().endScribble()

    const normalized = useCanvasStore
      .getState()
      .items.find((item) => item.id === id)
    expect(
      normalized?.type === 'scribble' &&
        normalized.paths[0].points.every(
          (point) => point.x >= 0 && point.y >= 0,
        ),
    ).toBe(true)
  })

  it('finalizes the layer when leaving the pen tool', () => {
    const store = useCanvasStore.getState()
    store.setTool('scribble')
    const id = store.startScribble({ x: 10, y: 10 })
    store.appendScribblePoint(id, { x: 20, y: 20 })
    store.endScribble()
    expect(useCanvasStore.getState().activeScribbleId).toBe(id)

    useCanvasStore.getState().setTool('select')
    expect(useCanvasStore.getState().activeScribbleId).toBeNull()
    // Item remains as a single free body
    expect(useCanvasStore.getState().items).toHaveLength(1)
  })

  it('reopens a layer via enterScribbleEdit for more strokes', () => {
    const store = useCanvasStore.getState()
    store.setTool('scribble')
    const id = store.startScribble({ x: 0, y: 0 })
    store.appendScribblePoint(id, { x: 30, y: 0 })
    store.endScribble()
    store.setTool('select')
    expect(useCanvasStore.getState().activeScribbleId).toBeNull()

    useCanvasStore.getState().enterScribbleEdit(id)
    const after = useCanvasStore.getState()
    expect(after.tool).toBe('scribble')
    expect(after.activeScribbleId).toBe(id)
    expect(after.selectedIds).toEqual([id])

    const id2 = after.startScribble({ x: 40, y: 40 })
    expect(id2).toBe(id)
    const item = useCanvasStore.getState().items.find((i) => i.id === id)
    expect(item?.type === 'scribble' && item.paths.length).toBe(2)
  })

  it('starts a fresh layer after finalize + pen again', () => {
    const store = useCanvasStore.getState()
    store.setTool('scribble')
    const a = store.startScribble({ x: 0, y: 0 })
    store.appendScribblePoint(a, { x: 5, y: 5 })
    store.endScribble()
    store.setTool('select')

    useCanvasStore.getState().setTool('scribble')
    const b = useCanvasStore.getState().startScribble({ x: 100, y: 100 })
    useCanvasStore.getState().appendScribblePoint(b, { x: 110, y: 110 })
    expect(b).not.toBe(a)
    expect(useCanvasStore.getState().items.filter((i) => i.type === 'scribble')).toHaveLength(2)
  })
})
