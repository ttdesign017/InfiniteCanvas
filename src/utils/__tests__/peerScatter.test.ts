import { describe, expect, it } from 'vitest'
import {
  PEER_SCATTER_DIST_CAP_PX,
  PEER_SCATTER_DIST_FACTOR,
  PEER_SCATTER_MAX_BLUR_PX,
  PEER_SCATTER_MAX_PX,
  PEER_SCATTER_MAX_SCALE_ADD,
  freeItemWrapAllowsPointer,
  peerRadialOffset,
  peerScatterAmount,
  peerScatterStyle,
  peerScatterWrapClassName,
} from '../peerScatter'

describe('peerScatter', () => {
  it('maps opacity to symmetric scatter amount (enter fade-out / exit fade-in)', () => {
    expect(peerScatterAmount(1)).toBe(0)
    expect(peerScatterAmount(0)).toBe(1)
    expect(peerScatterAmount(0.5)).toBeCloseTo(0.5)
  })

  it('pushes peers away from the focus origin (not toward it)', () => {
    const { dx, dy } = peerRadialOffset(
      { x: 100, y: 50 },
      { x: 0, y: 50 },
      1,
      'a',
    )
    // Right of focus → positive X only
    expect(dx).toBeGreaterThan(0)
    expect(dy).toBeCloseTo(0)
    const expected =
      PEER_SCATTER_MAX_PX +
      Math.min(PEER_SCATTER_DIST_CAP_PX, 100 * PEER_SCATTER_DIST_FACTOR)
    expect(dx).toBeCloseTo(expected)
  })

  it('left-side peers move further left (radiate from focus)', () => {
    const { dx, dy } = peerRadialOffset(
      { x: -40, y: 10 },
      { x: 80, y: 10 },
      1,
      'left',
    )
    expect(dx).toBeLessThan(0)
    expect(dy).toBeCloseTo(0)
  })

  it('uses a stable fallback direction when centers coincide', () => {
    const a = peerRadialOffset({ x: 10, y: 10 }, { x: 10, y: 10 }, 1, 'seed-x')
    const b = peerRadialOffset({ x: 10, y: 10 }, { x: 10, y: 10 }, 1, 'seed-x')
    expect(a.dx).toBeCloseTo(b.dx)
    expect(a.dy).toBeCloseTo(b.dy)
    expect(Math.hypot(a.dx, a.dy)).toBeCloseTo(
      PEER_SCATTER_MAX_PX +
        Math.min(PEER_SCATTER_DIST_CAP_PX, 1 * PEER_SCATTER_DIST_FACTOR),
    )
  })

  it('at rest opacity produces no transform or blur (handoff-safe)', () => {
    const style = peerScatterStyle(
      { x: 20, y: 20 },
      { x: 0, y: 0 },
      1,
      'id',
    )
    expect(style).toEqual({ opacity: 1 })
  })

  it('at full scatter applies outward translate, mild scale, and blur', () => {
    const style = peerScatterStyle(
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      0,
      'id',
    )
    expect(style.opacity).toBe(0)
    const scale = 1 + PEER_SCATTER_MAX_SCALE_ADD
    expect(style.transform).toContain(`scale(${scale})`)
    const dist =
      PEER_SCATTER_MAX_PX +
      Math.min(PEER_SCATTER_DIST_CAP_PX, 100 * PEER_SCATTER_DIST_FACTOR)
    expect(style.transform).toContain(`translate3d(${dist}px`)
    expect(style.filter).toBe(`blur(${PEER_SCATTER_MAX_BLUR_PX.toFixed(2)}px)`)
  })

  it('live free items are never marked as non-interactive ghosts', () => {
    expect(peerScatterWrapClassName({ isGhost: false })).toBe('peer-scatter-wrap')
    expect(peerScatterWrapClassName({ isGhost: false })).not.toContain(
      'is-peer-ghost',
    )
    expect(peerScatterWrapClassName({ isGhost: true })).toContain('is-peer-ghost')
    expect(peerScatterWrapClassName({ active: false })).toBe('')
  })

  it('idle free-item wraps always allow pointer hits (regression: single select/move)', () => {
    expect(freeItemWrapAllowsPointer(false, 1)).toBe(true)
    expect(freeItemWrapAllowsPointer(false, 0.2)).toBe(true)
    // Fully faded mid-handoff may block; fully visible must not brick selection
    expect(freeItemWrapAllowsPointer(true, 1)).toBe(true)
    expect(freeItemWrapAllowsPointer(true, 0.5)).toBe(false)
  })
})
