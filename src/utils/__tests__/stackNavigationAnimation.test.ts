import { describe, expect, it } from 'vitest'
import {
  exitLeavingFanBridgeOpacity,
  exitLeavingFanCompositeOpacity,
  exitPeerStackPreviewOpacity,
  peerStackGhostOwnsLayer,
} from '../stackNavigationAnimation'

describe('stack navigation peer ownership', () => {
  it('hands peer stacks from ghost to the real parent layer exactly once', () => {
    expect(peerStackGhostOwnsLayer('exit', 'leaving', 'leaving')).toBe(true)
    expect(peerStackGhostOwnsLayer('exit', 'leaving', 'root')).toBe(false)
    expect(peerStackGhostOwnsLayer('enter', 'entering', 'entering')).toBe(true)
    expect(peerStackGhostOwnsLayer(null, null, 'root')).toBe(false)
  })

  it('keeps sibling fan opacity continuous and monotonic across handoff', () => {
    const reveal = [0, 0.16, 0.52, 0.81, 0.94, 1]
    const realLayer = reveal.map((opacity) =>
      exitPeerStackPreviewOpacity(
        true,
        'leaving',
        'sibling',
        opacity,
      ),
    )

    expect(realLayer).toEqual(reveal)
    expect(
      realLayer.every(
        (value, index) => index === 0 || value >= realLayer[index - 1],
      ),
    ).toBe(true)
    expect(exitPeerStackPreviewOpacity(true, 'leaving', 'leaving', 0.4)).toBe(1)
    expect(exitPeerStackPreviewOpacity(true, 'leaving', 'sibling', 1.5)).toBe(1)
  })
})

describe('exitLeavingFanBridgeOpacity', () => {
  it('holds fully opaque through settle, then hard-cuts off (no dual-shadow crossfade)', () => {
    expect(exitLeavingFanBridgeOpacity(0)).toBe(1)
    expect(exitLeavingFanBridgeOpacity(0.5)).toBe(1)
    expect(exitLeavingFanBridgeOpacity(0.97)).toBe(1)
    expect(exitLeavingFanBridgeOpacity(0.98)).toBe(0)
    expect(exitLeavingFanBridgeOpacity(1)).toBe(0)
  })

  it('keeps composite invisible while bridge owns the fan', () => {
    expect(exitLeavingFanCompositeOpacity(0)).toBe(0)
    expect(exitLeavingFanCompositeOpacity(0.5)).toBe(0)
    expect(exitLeavingFanCompositeOpacity(1)).toBe(1)
    // Never both visible (would double box-shadow)
    for (let i = 0; i <= 20; i++) {
      const s = i / 20
      const both =
        exitLeavingFanBridgeOpacity(s) > 0.5 &&
        exitLeavingFanCompositeOpacity(s) > 0.5
      expect(both).toBe(false)
    }
  })
})
