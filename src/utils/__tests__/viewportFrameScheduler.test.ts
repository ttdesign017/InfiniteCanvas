import { describe, expect, it, vi } from 'vitest'
import type { Viewport } from '../../types/canvas'
import {
  applyViewportOperation,
  createViewportFrameScheduler,
} from '../viewportFrameScheduler'

describe('viewportFrameScheduler', () => {
  it('coalesces many pan events into one frame/store commit', () => {
    let viewport: Viewport = { x: 10, y: 20, zoom: 1 }
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextHandle = 1
    const commit = vi.fn((next: Viewport) => {
      viewport = next
    })
    const scheduler = createViewportFrameScheduler({
      getViewport: () => viewport,
      commitViewport: commit,
      requestFrame: (callback) => {
        const handle = nextHandle++
        callbacks.set(handle, callback)
        return handle
      },
      cancelFrame: (handle) => {
        callbacks.delete(handle)
      },
    })

    scheduler.panBy(2, 3)
    scheduler.panBy(4, -1)
    scheduler.panBy(-1, 5)

    expect(commit).not.toHaveBeenCalled()
    expect(callbacks.size).toBe(1)
    callbacks.values().next().value?.(0)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(viewport).toEqual({ x: 15, y: 27, zoom: 1 })
  })

  it('preserves pan/zoom operation order around the zoom anchor', () => {
    const start: Viewport = { x: 0, y: 0, zoom: 1 }
    const panned = applyViewportOperation(start, {
      kind: 'pan',
      dx: 20,
      dy: 10,
    })
    const zoomed = applyViewportOperation(panned, {
      kind: 'zoom',
      screenX: 100,
      screenY: 80,
      factor: 2,
    })
    expect(zoomed).toEqual({ x: -60, y: -60, zoom: 2 })
  })

  it('flushes pending input synchronously and cancels the scheduled frame', () => {
    let viewport: Viewport = { x: 0, y: 0, zoom: 1 }
    const cancel = vi.fn()
    const commit = vi.fn((next: Viewport) => {
      viewport = next
    })
    const scheduler = createViewportFrameScheduler({
      getViewport: () => viewport,
      commitViewport: commit,
      requestFrame: () => 42,
      cancelFrame: cancel,
    })

    scheduler.panBy(8, 9)
    scheduler.flush()

    expect(cancel).toHaveBeenCalledWith(42)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(viewport).toEqual({ x: 8, y: 9, zoom: 1 })
    expect(scheduler.hasPending()).toBe(false)
  })
})
