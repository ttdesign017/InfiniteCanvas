import type { Viewport } from '../types/canvas'

type ViewportOperation =
  | { kind: 'pan'; dx: number; dy: number }
  | {
      kind: 'zoom'
      screenX: number
      screenY: number
      factor: number
    }

export type ViewportFrameScheduler = {
  panBy: (dx: number, dy: number) => void
  zoomAt: (
    screenX: number,
    screenY: number,
    factor: number,
  ) => void
  flush: () => void
  cancel: () => void
  hasPending: () => boolean
}

export function applyViewportOperation(
  viewport: Viewport,
  operation: ViewportOperation,
): Viewport {
  if (operation.kind === 'pan') {
    if (operation.dx === 0 && operation.dy === 0) return viewport
    return {
      ...viewport,
      x: viewport.x + operation.dx,
      y: viewport.y + operation.dy,
    }
  }

  if (!Number.isFinite(operation.factor) || operation.factor <= 0) {
    return viewport
  }
  const zoom = Math.max(0.0001, viewport.zoom)
  const nextZoom = Math.min(8, Math.max(0.08, zoom * operation.factor))
  if (nextZoom === viewport.zoom) return viewport
  const wx = (operation.screenX - viewport.x) / zoom
  const wy = (operation.screenY - viewport.y) / zoom
  return {
    zoom: nextZoom,
    x: operation.screenX - wx * nextZoom,
    y: operation.screenY - wy * nextZoom,
  }
}

/**
 * Coalesces high-frequency pointer/wheel viewport mutations into one store
 * commit per animation frame. Operations remain ordered and are applied to
 * the latest committed viewport, so external navigation updates are not lost.
 */
export function createViewportFrameScheduler(options: {
  getViewport: () => Viewport
  commitViewport: (viewport: Viewport) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}): ViewportFrameScheduler {
  const requestFrame =
    options.requestFrame ??
    ((callback: FrameRequestCallback) => requestAnimationFrame(callback))
  const cancelFrame =
    options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle))

  let operations: ViewportOperation[] = []
  let frame: number | null = null

  const commitPending = () => {
    frame = null
    if (operations.length === 0) return
    const pending = operations
    operations = []
    const before = options.getViewport()
    let after = before
    for (const operation of pending) {
      after = applyViewportOperation(after, operation)
    }
    if (
      after !== before &&
      (after.x !== before.x ||
        after.y !== before.y ||
        after.zoom !== before.zoom)
    ) {
      options.commitViewport(after)
    }
  }

  const ensureFrame = () => {
    if (frame != null) return
    frame = requestFrame(commitPending)
  }

  return {
    panBy(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
      const last = operations[operations.length - 1]
      if (last?.kind === 'pan') {
        last.dx += dx
        last.dy += dy
      } else {
        operations.push({ kind: 'pan', dx, dy })
      }
      ensureFrame()
    },
    zoomAt(screenX, screenY, factor) {
      if (
        !Number.isFinite(screenX) ||
        !Number.isFinite(screenY) ||
        !Number.isFinite(factor) ||
        factor <= 0
      ) {
        return
      }
      operations.push({ kind: 'zoom', screenX, screenY, factor })
      ensureFrame()
    },
    flush() {
      if (frame != null) {
        cancelFrame(frame)
        frame = null
      }
      commitPending()
    },
    cancel() {
      if (frame != null) cancelFrame(frame)
      frame = null
      operations = []
    },
    hasPending() {
      return operations.length > 0
    },
  }
}
