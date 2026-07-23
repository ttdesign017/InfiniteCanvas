/**
 * Shared fan-card chrome for live DOM + stackFanComposite bitmap.
 * Keep these in lockstep so exit handoff never pops shadow/edge.
 */

/** Final light edge alpha on stacked fan cards (subtle gray-white). */
export const STACK_FAN_EDGE_ALPHA = 0.55

export const STACK_FAN_RADIUS_PX = 10

/** CSS / canvas dual soft shadow — identical numbers both paths. */
export const STACK_FAN_SHADOW = {
  far: {
    offsetY: 10,
    blur: 28,
    color: 'rgba(0, 0, 0, 0.2)',
  },
  near: {
    offsetY: 3,
    blur: 8,
    color: 'rgba(0, 0, 0, 0.16)',
  },
} as const

/**
 * White edge opacity during exit gather (t = morph 0..1).
 * Full strength well before handoff so composite swap does not pop the edge.
 */
export function stackFanEdgeOpacityDuringExit(t: number): number {
  const u = Math.max(0, Math.min(1, t / 0.7))
  // smoothstep
  const s = u * u * (3 - 2 * u)
  return STACK_FAN_EDGE_ALPHA * s
}

/** Enter / idle stacked look — full chrome. */
export function stackFanEdgeOpacityIdle(): number {
  return STACK_FAN_EDGE_ALPHA
}

/**
 * Surface CSS var for live is-stacked cards during nav.
 * Exit: ramp with gather t. Enter / idle: full (composites already baked full).
 */
export function stackFanEdgeOpacityForNav(
  mode: 'enter' | 'exit' | null | undefined,
  t: number,
): number {
  if (mode === 'exit') return stackFanEdgeOpacityDuringExit(t)
  return STACK_FAN_EDGE_ALPHA
}
