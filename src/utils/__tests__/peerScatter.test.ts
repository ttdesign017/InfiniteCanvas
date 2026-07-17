import { describe, expect, it } from 'vitest'
import {
  PEER_SCATTER_MAX_BLUR_PX,
  PEER_SCATTER_MAX_PX,
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

  it('pushes peers away from the focus origin', () => {
    const { dx, dy } = peerRadialOffset(
      { x: 100, y: 50 },
      { x: 0, y: 50 },
      1,
      'a',
    )
    expect(dx).toBeCloseTo(PEER_SCATTER_MAX_PX)
    expect(dy).toBeCloseTo(0)
  })

  it('uses a stable fallback direction when centers coincide', () => {
    const a = peerRadialOffset({ x: 10, y: 10 }, { x: 10, y: 10 }, 1, 'seed-x')
    const b = peerRadialOffset({ x: 10, y: 10 }, { x: 10, y: 10 }, 1, 'seed-x')
    expect(a.dx).toBeCloseTo(b.dx)
    expect(a.dy).toBeCloseTo(b.dy)
    expect(Math.hypot(a.dx, a.dy)).toBeCloseTo(PEER_SCATTER_MAX_PX)
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

  it('at full scatter applies scale, radial translate, and blur ≤ 6', () => {
    const style = peerScatterStyle(
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      0,
      'id',
    )
    expect(style.opacity).toBe(0)
    expect(style.transform).toContain('scale(1.12)')
    expect(style.transform).toContain(`translate(${PEER_SCATTER_MAX_PX}px`)
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
