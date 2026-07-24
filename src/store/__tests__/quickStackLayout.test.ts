/**
 * Ctrl+G: collapsed fan on parent; free layout inside = pre-stack relative layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasItem } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import { revokeAllTrackedBlobUrls } from '../../utils/blobUrls'
import { computeQuickStack, STACK_FOLDER_PAD } from '../../utils/layout'
import { buildNestFreePoses } from '../../utils/nestFreeLayout'
import { containerOf } from '../../utils/stacks'
import { useCanvasStore } from '../useCanvasStore'

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
function flushRafUntilIdle(max = 40) {
  for (let i = 0; i < max && rafQueue.length > 0; i++) {
    const batch = rafQueue.splice(0, rafQueue.length)
    // Drive ease to completion: pass a large now so t >= 1
    for (const cb of batch) cb(performance.now() + 10_000)
  }
}

const media = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  rotation = 0,
): CanvasItem =>
  ({
    id,
    type: 'image',
    x,
    y,
    width: w,
    height: h,
    rotation,
    zIndex: z,
    src: `blob:${id}`,
    fileName: `${id}.png`,
    naturalWidth: w,
    naturalHeight: h,
  }) as CanvasItem

function baseState(items: CanvasItem[]) {
  return {
    items,
    stacks: [],
    currentContainerId: ROOT_CONTAINER_ID,
    homeViewport: { x: 0, y: 0, zoom: 1 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nextZ: 10,
    selectedIds: items.map((i) => i.id),
    selectedStackIds: [],
    dirty: false,
    animating: false,
    pendingNavigation: null,
    stackEnterAnim: null,
    history: [],
    future: [],
    editingId: null,
    editingStackGroupId: null,
  }
}

describe('quickStack free layout preserves pre-stack arrangement', () => {
  afterEach(() => {
    revokeAllTrackedBlobUrls()
    rafQueue.length = 0
  })

  beforeEach(() => {
    useCanvasStore.setState(
      baseState([
        media('a', 100, 200, 120, 80, 1),
        media('b', 280, 240, 160, 100, 2),
        media('c', 140, 360, 90, 90, 3),
      ]),
    )
  })

  it('anchors free origin at STACK_FOLDER_PAD and keeps relative layout', () => {
    const before = useCanvasStore.getState().items
    const pre = new Map(
      before.map((i) => [i.id, { x: i.x, y: i.y, rotation: i.rotation ?? 0 }]),
    )
    const expectedFree = buildNestFreePoses(
      before.map((i) => i.id),
      pre,
      STACK_FOLDER_PAD,
    )

    useCanvasStore.getState().quickStack()
    flushRafUntilIdle()

    const state = useCanvasStore.getState()
    expect(state.animating).toBe(false)
    expect(state.stacks).toHaveLength(1)
    const stack = state.stacks[0]

    const members = state.items.filter((i) => containerOf(i) === stack.id)
    expect(members).toHaveLength(3)

    const minX = Math.min(...members.map((m) => m.x))
    const minY = Math.min(...members.map((m) => m.y))
    expect(minX).toBeCloseTo(STACK_FOLDER_PAD, 5)
    expect(minY).toBeCloseTo(STACK_FOLDER_PAD, 5)

    for (const m of members) {
      const exp = expectedFree.get(m.id)!
      expect(m.x).toBeCloseTo(exp.x, 5)
      expect(m.y).toBeCloseTo(exp.y, 5)
      expect(m.rotation).toBeCloseTo(exp.rotation, 5)
      expect(m.stacked).toBeFalsy()
      expect(m.stackGroupId).toBeUndefined()
      expect(m.stackPreview).toBeDefined()
    }
  })

  it('stores stackPreview at computeQuickStack fan end poses', () => {
    const ordered = [...useCanvasStore.getState().items].sort(
      (a, b) => a.zIndex - b.zIndex,
    )
    const fanTargets = computeQuickStack(ordered)
    const fanById = new Map(fanTargets.map((t) => [t.id, t]))

    useCanvasStore.getState().quickStack()
    flushRafUntilIdle()

    const stack = useCanvasStore.getState().stacks[0]
    const members = useCanvasStore
      .getState()
      .items.filter((i) => containerOf(i) === stack.id)

    for (const m of members) {
      const fan = fanById.get(m.id)!
      expect(m.stackPreview!.x).toBeCloseTo(fan.x, 5)
      expect(m.stackPreview!.y).toBeCloseTo(fan.y, 5)
      expect(m.stackPreview!.rotation).toBeCloseTo(fan.rotation ?? 0, 5)
    }

    // Fan is an offset pile: span must be tighter than free layout span
    const freeSpanX =
      Math.max(...members.map((m) => m.x)) - Math.min(...members.map((m) => m.x))
    const fanSpanX =
      Math.max(...members.map((m) => m.stackPreview!.x)) -
      Math.min(...members.map((m) => m.stackPreview!.x))
    expect(fanSpanX).toBeLessThan(freeSpanX)
  })

  it('preserves non-zero free rotations inside the stack', () => {
    useCanvasStore.setState(
      baseState([
        media('a', 50, 50, 100, 80, 1, 0),
        media('b', 200, 80, 100, 80, 2, 15),
        media('c', 90, 200, 100, 80, 3, -8),
      ]),
    )

    useCanvasStore.getState().quickStack()
    flushRafUntilIdle()

    const stack = useCanvasStore.getState().stacks[0]
    const byId = new Map(
      useCanvasStore
        .getState()
        .items.filter((i) => containerOf(i) === stack.id)
        .map((i) => [i.id, i]),
    )
    expect(byId.get('a')!.rotation).toBeCloseTo(0, 5)
    expect(byId.get('b')!.rotation).toBeCloseTo(15, 5)
    expect(byId.get('c')!.rotation).toBeCloseTo(-8, 5)
    // Relative free positions still hold
    expect(byId.get('b')!.x - byId.get('a')!.x).toBeCloseTo(150, 5)
    expect(byId.get('c')!.y - byId.get('a')!.y).toBeCloseTo(150, 5)
  })

  it('enter continuity: free ends match stored free; starts are fan-local', () => {
    useCanvasStore.getState().quickStack()
    flushRafUntilIdle()

    const state = useCanvasStore.getState()
    const stack = state.stacks[0]
    const members = state.items.filter((i) => containerOf(i) === stack.id)

    // What enterStack uses as free ends (member free poses)
    const freeEnds = members.map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
      rotation: m.rotation ?? 0,
    }))
    // What enterStack uses as starts (stackPreview -> local)
    const enterStarts = members.map((m) => ({
      id: m.id,
      x: (m.stackPreview?.x ?? stack.x + STACK_FOLDER_PAD) - stack.x,
      y: (m.stackPreview?.y ?? stack.y + STACK_FOLDER_PAD) - stack.y,
      rotation: m.stackPreview?.rotation ?? 0,
    }))

    // Free ends stay at pad-anchored pre-stack layout
    expect(Math.min(...freeEnds.map((e) => e.x))).toBeCloseTo(
      STACK_FOLDER_PAD,
      5,
    )
    expect(Math.min(...freeEnds.map((e) => e.y))).toBeCloseTo(
      STACK_FOLDER_PAD,
      5,
    )

    // Fan-local starts form a tighter pile than free ends (enter expands outward)
    const startSpanX =
      Math.max(...enterStarts.map((s) => s.x)) -
      Math.min(...enterStarts.map((s) => s.x))
    const endSpanX =
      Math.max(...freeEnds.map((e) => e.x)) -
      Math.min(...freeEnds.map((e) => e.x))
    expect(startSpanX).toBeLessThan(endSpanX)

    // start = stackPreview - stack.origin (enterStack formula)
    for (const m of members) {
      const start = enterStarts.find((s) => s.id === m.id)!
      expect(start.x).toBeCloseTo(m.stackPreview!.x - stack.x, 5)
      expect(start.y).toBeCloseTo(m.stackPreview!.y - stack.y, 5)
      expect(start.rotation).toBeCloseTo(m.stackPreview!.rotation ?? 0, 5)
    }
  })
})
