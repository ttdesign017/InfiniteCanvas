/**
 * Peer scatter for stack enter/exit: radial push away from the focus stack,
 * slight scale-up, and light blur — driven only by peer opacity so enter/exit
 * stay symmetric and handoff does not jump (same formula on ghost + real layer).
 */

export const PEER_SCATTER_MAX_PX = 56
/** Extra scale at full scatter (1 → 1.12) */
export const PEER_SCATTER_MAX_SCALE_ADD = 0.12
export const PEER_SCATTER_MAX_BLUR_PX = 6

export function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t))
}

/**
 * Scatter progress from peer opacity.
 * enter: opacity 1→0 ⇒ scatter 0→1 (push out while fading)
 * exit:  opacity 0→1 ⇒ scatter 1→0 (pull in while appearing)
 */
export function peerScatterAmount(peerOpacity: number): number {
  return 1 - clamp01(peerOpacity)
}

/** Stable fallback angle (radians) when a peer is centered on the focus stack. */
export function peerFallbackAngle(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 360) * (Math.PI / 180)
}

export function peerRadialOffset(
  center: { x: number; y: number },
  origin: { x: number; y: number },
  amount: number,
  seed = 'peer',
): { dx: number; dy: number } {
  const a = clamp01(amount)
  if (a < 1e-6) return { dx: 0, dy: 0 }

  let vx = center.x - origin.x
  let vy = center.y - origin.y
  let len = Math.hypot(vx, vy)
  if (len < 0.5) {
    const ang = peerFallbackAngle(seed)
    vx = Math.cos(ang)
    vy = Math.sin(ang)
    len = 1
  }
  const dist = PEER_SCATTER_MAX_PX * a
  return { dx: (vx / len) * dist, dy: (vy / len) * dist }
}

export type PeerScatterStyle = {
  opacity: number
  transform?: string
  filter?: string
  willChange?: string
}

/**
 * CSS for a peer wrapper. `center` is the peer's visual center in the same
 * coordinate space as `origin` (local for ghosts, world for real parent layer).
 */
export function peerScatterStyle(
  center: { x: number; y: number },
  origin: { x: number; y: number },
  peerOpacity: number,
  seed = 'peer',
): PeerScatterStyle {
  const opacity = clamp01(peerOpacity)
  const amount = peerScatterAmount(opacity)
  if (amount < 0.001) {
    return { opacity }
  }

  const { dx, dy } = peerRadialOffset(center, origin, amount, seed)
  const scale = 1 + PEER_SCATTER_MAX_SCALE_ADD * amount
  const blur = PEER_SCATTER_MAX_BLUR_PX * amount

  // Translate scatter, then scale about the peer center (same space as children).
  const transform = `translate(${dx}px, ${dy}px) translate(${center.x}px, ${center.y}px) scale(${scale}) translate(${-center.x}px, ${-center.y}px)`

  return {
    opacity,
    transform,
    filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
    willChange: 'transform, opacity, filter',
  }
}

export function rectCenter(r: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

/**
 * Wrapper class for peer scatter layers.
 * - Interactive free items on the live canvas must NOT be non-interactive ghosts.
 * - Enter/exit ghost peers should set `isGhost: true` so hits pass through.
 */
export function peerScatterWrapClassName(options: {
  isGhost?: boolean
  /** When false, omit scatter class entirely (idle free items). */
  active?: boolean
}): string {
  const active = options.active !== false
  if (!active) return ''
  return options.isGhost
    ? 'peer-scatter-wrap is-peer-ghost'
    : 'peer-scatter-wrap'
}

/**
 * Whether a free item on the live canvas should accept pointer hits.
 * Scatter/fade during exit handoff may still be interactive once anim ends;
 * never force pointer-events:none on idle free items.
 */
export function freeItemWrapAllowsPointer(
  exitAfterHandoff: boolean,
  peerOpacity: number,
): boolean {
  // During handoff fade, interaction is store-locked anyway; still allow hits
  // when fully visible so a stuck peerReveal cannot brick selection forever.
  if (!exitAfterHandoff) return true
  return peerOpacity >= 0.99
}
