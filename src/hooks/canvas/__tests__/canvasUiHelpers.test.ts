// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  prewarmCanvasTransform,
  setPanChrome,
} from '../canvasUiHelpers'

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

function canvasDom() {
  const surface = document.createElement('div')
  surface.className = 'canvas-surface'
  const world = document.createElement('div')
  world.className = 'canvas-world'
  surface.appendChild(world)
  document.body.appendChild(surface)
  return { surface, world }
}

describe('canvas transform warming', () => {
  it('retains the promoted world briefly after pointer pan ends', () => {
    vi.useFakeTimers()
    const { surface, world } = canvasDom()

    setPanChrome(surface, true)
    expect(world.style.willChange).toBe('transform')
    expect(surface.classList.contains('is-panning')).toBe(true)

    setPanChrome(surface, false)
    expect(world.style.willChange).toBe('transform')
    expect(surface.classList.contains('is-panning')).toBe(false)

    vi.advanceTimersByTime(300)
    expect(world.style.willChange).toBe('auto')
  })

  it('extends the warm window across a wheel-event burst', () => {
    vi.useFakeTimers()
    const { surface, world } = canvasDom()

    prewarmCanvasTransform(surface)
    vi.advanceTimersByTime(200)
    prewarmCanvasTransform(surface)
    vi.advanceTimersByTime(200)
    expect(world.style.willChange).toBe('transform')

    vi.advanceTimersByTime(100)
    expect(world.style.willChange).toBe('auto')
  })
})
