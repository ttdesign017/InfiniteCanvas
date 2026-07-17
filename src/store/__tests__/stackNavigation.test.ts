/**
 * Characterization: enter / silent exit change container and leave stack z atomic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import { revokeAllTrackedBlobUrls } from '../../utils/blobUrls'
import { stackUnitsAreAtomicOnContainer } from '../../utils/zOrder'
import { useCanvasStore } from '../useCanvasStore'

// enterStack drives RAF layout/morph — queue async, never re-enter sync
let rafId = 0
const rafQueue: FrameRequestCallback[] = []
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  rafId += 1
  rafQueue.push(cb)
  return rafId
})
vi.stubGlobal('cancelAnimationFrame', () => {
  rafQueue.length = 0
})
function flushRaf(times = 3) {
  for (let i = 0; i < times; i++) {
    const batch = rafQueue.splice(0, rafQueue.length)
    for (const cb of batch) cb(performance.now())
  }
}

const note = (id: string, containerId: string, z: number): CanvasItem => ({
  id,
  type: 'text',
  x: 8,
  y: 8,
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

const stack = (
  id: string,
  parentId: string,
  z: number,
): StackRecord => ({
  id,
  parentId,
  name: id,
  x: 40,
  y: 40,
  width: 160,
  height: 120,
  zIndex: z,
  freeFanRel: [{ id: `leaf-${id}`, dx: 10, dy: 10, rotation: 0 }],
})

describe('stack enter / silent exit', () => {
  afterEach(() => {
    revokeAllTrackedBlobUrls()
  })

  beforeEach(() => {
    useCanvasStore.setState({
      items: [
        note('leaf-a', 'a', 2),
        note('leaf-b', 'b', 3),
        note('free', ROOT_CONTAINER_ID, 1),
      ],
      stacks: [
        stack('a', ROOT_CONTAINER_ID, 4),
        stack('b', ROOT_CONTAINER_ID, 5),
      ],
      currentContainerId: ROOT_CONTAINER_ID,
      homeViewport: { x: 0, y: 0, zoom: 1 },
      viewport: { x: 0, y: 0, zoom: 1 },
      nextZ: 10,
      selectedIds: [],
      selectedStackIds: [],
      dirty: false,
      animating: false,
      pendingNavigation: null,
      stackEnterAnim: null,
      history: [],
      future: [],
    })
  })

  it('enterStack switches currentContainerId into the stack', () => {
    useCanvasStore.getState().enterStack('a', {
      x: 100,
      y: 100,
      w: 200,
      h: 150,
    })
    // Container should switch even before morph RAF finishes
    expect(useCanvasStore.getState().currentContainerId).toBe('a')
    flushRaf(5)
    const s = useCanvasStore.getState()
    expect(s.currentContainerId).toBe('a')
  })

  it('silent navigateToContainer(root) exits and keeps stack units atomic', () => {
    // Start inside A without animation lock
    useCanvasStore.setState({
      currentContainerId: 'a',
      animating: false,
      stackEnterAnim: null,
      pendingNavigation: null,
    })

    useCanvasStore.getState().navigateToContainer(ROOT_CONTAINER_ID, {
      animate: false,
    })

    const s = useCanvasStore.getState()
    expect(s.currentContainerId).toBe(ROOT_CONTAINER_ID)
    expect(s.animating).toBe(false)
    expect(s.pendingNavigation).toBeNull()
    expect(stackUnitsAreAtomicOnContainer(s.items, s.stacks)).toBe(true)
  })

  it('selectStacks raises z and marks dirty when order changes', () => {
    useCanvasStore.setState({ dirty: false })
    useCanvasStore.getState().selectStacks(['a'])
    const s = useCanvasStore.getState()
    expect(s.selectedStackIds).toEqual(['a'])
    // Raising a body to the front should dirty the board for save prompts
    expect(s.dirty).toBe(true)
    expect(stackUnitsAreAtomicOnContainer(s.items, s.stacks)).toBe(true)
  })
})
