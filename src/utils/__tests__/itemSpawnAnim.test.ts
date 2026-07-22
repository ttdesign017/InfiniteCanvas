import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearItemSpawnVisual,
  easeInOutCubic,
  easeOutCubic,
  getItemSpawnVisual,
  runSnapshotSpawnAnimation,
  setItemSpawnVisual,
} from '../itemSpawnAnim'

afterEach(() => {
  clearItemSpawnVisual('a')
  clearItemSpawnVisual('b')
  vi.restoreAllMocks()
})

describe('itemSpawnAnim easing', () => {
  it('easeOutCubic starts at 0 and ends at 1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })

  it('easeInOutCubic is slow at both ends', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25)
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75)
  })
})

describe('itemSpawnAnim store', () => {
  it('sets and clears visuals', () => {
    setItemSpawnVisual('a', { opacity: 0.5, dy: -10, scale: 0.9 })
    expect(getItemSpawnVisual('a')).toEqual({ opacity: 0.5, dy: -10, scale: 0.9 })
    clearItemSpawnVisual('a')
    expect(getItemSpawnVisual('a')).toBeNull()
  })
})

describe('runSnapshotSpawnAnimation', () => {
  it('shrinks quickly then grows while moving down', () => {
    vi.useFakeTimers()
    const rafQueue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const distanceY = 200 // e.g. video height + gap
    runSnapshotSpawnAnimation('a', {
      distanceY,
      shrinkMs: 100,
      settleMs: 100,
      minScale: 0.8,
    })

    // Starts full size over the source
    expect(getItemSpawnVisual('a')).toMatchObject({
      opacity: 1,
      dy: -distanceY,
      scale: 1,
    })

    // Mid shrink
    now = 50
    rafQueue.shift()?.(now)
    const midShrink = getItemSpawnVisual('a')
    expect(midShrink).not.toBeNull()
    expect(midShrink!.scale).toBeLessThan(1)
    expect(midShrink!.scale).toBeGreaterThan(0.8)
    expect(midShrink!.dy).toBe(-distanceY)

    // End shrink / start settle
    now = 100
    rafQueue.shift()?.(now)
    expect(getItemSpawnVisual('a')?.scale).toBeCloseTo(0.8, 2)
    expect(getItemSpawnVisual('a')?.dy).toBe(-distanceY)

    // Mid settle — scale recovering, dy moving toward 0
    now = 150
    rafQueue.shift()?.(now)
    const midSettle = getItemSpawnVisual('a')
    expect(midSettle).not.toBeNull()
    expect(midSettle!.scale).toBeGreaterThan(0.8)
    expect(midSettle!.scale).toBeLessThan(1)
    expect(midSettle!.dy).toBeGreaterThan(-distanceY)
    expect(midSettle!.dy).toBeLessThan(0)

    // Complete
    now = 250
    rafQueue.shift()?.(now)
    expect(getItemSpawnVisual('a')).toBeNull()

    vi.useRealTimers()
  })
})
