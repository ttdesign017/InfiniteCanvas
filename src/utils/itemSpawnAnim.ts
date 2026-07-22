/**
 * Ephemeral visual overrides for items that should not flash in at full
 * opacity / final pose (e.g. video frame snapshot "shutter" animation).
 *
 * Render layer reads via useSyncExternalStore; store holds the final pose
 * while CSS applies transient scale / dy on top.
 */

export interface ItemSpawnVisual {
  opacity: number
  /** Extra world-space translation applied only while animating */
  dy: number
  /** Uniform scale (1 = rest size). Applied around item center. */
  scale: number
}

type Listener = () => void

const visuals = new Map<string, ItemSpawnVisual>()
const listeners = new Set<Listener>()
let version = 0
const rafById = new Map<string, number>()

function emit() {
  version += 1
  listeners.forEach((l) => l())
}

export function getItemSpawnVersion(): number {
  return version
}

export function getItemSpawnVisual(id: string): ItemSpawnVisual | null {
  return visuals.get(id) ?? null
}

export function setItemSpawnVisual(id: string, visual: ItemSpawnVisual | null): void {
  if (!visual) {
    if (!visuals.has(id)) return
    visuals.delete(id)
    emit()
    return
  }
  visuals.set(id, visual)
  emit()
}

export function clearItemSpawnVisual(id: string): void {
  const raf = rafById.get(id)
  if (raf != null) {
    cancelAnimationFrame(raf)
    rafById.delete(id)
  }
  if (visuals.has(id)) {
    visuals.delete(id)
    emit()
  }
}

export function subscribeItemSpawn(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Smoothstep-style ease-in-out cubic (slow → fast → slow). */
export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return 1 - Math.pow(1 - x, 3)
}

export function easeInCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * x
}

export type SnapshotSpawnOptions = {
  /** Phase 1: quick shrink duration (ms) */
  shrinkMs?: number
  /** Phase 2: grow + move-down duration (ms) */
  settleMs?: number
  /** Peak shrink factor (1 = no shrink). Default 0.8 */
  minScale?: number
  /**
   * World-space distance the frame travels downward.
   * Item must already sit at its *final* y; animation starts with
   * visual `dy = -distanceY` (over the video) and eases to `dy = 0`.
   */
  distanceY: number
  /** Called after visuals settle (opacity 1, dy 0, scale 1) */
  onComplete?: () => void
}

/**
 * Photo-shutter spawn:
 * 1) Quick shrink to ~80% while still over the video.
 * 2) Slow ease back to 100% while sliding down to rest below the video.
 */
export function runSnapshotSpawnAnimation(
  id: string,
  options: SnapshotSpawnOptions,
): void {
  const shrinkMs = options.shrinkMs ?? 140
  const settleMs = options.settleMs ?? 640
  const minScale = options.minScale ?? 0.8
  const distanceY = options.distanceY
  const startDy = -distanceY

  const prev = rafById.get(id)
  if (prev != null) cancelAnimationFrame(prev)

  setItemSpawnVisual(id, { opacity: 1, dy: startDy, scale: 1 })

  const t0 = performance.now()

  const tick = (now: number) => {
    const elapsed = now - t0

    // Phase 1: rapid shrink 1 → minScale, stay on video
    if (elapsed < shrinkMs) {
      const t = easeOutCubic(elapsed / shrinkMs)
      const scale = 1 + (minScale - 1) * t
      setItemSpawnVisual(id, { opacity: 1, dy: startDy, scale })
      rafById.set(id, requestAnimationFrame(tick))
      return
    }

    // Phase 2: grow minScale → 1 while moving down
    const settleElapsed = elapsed - shrinkMs
    if (settleElapsed < settleMs) {
      const t = easeInOutCubic(settleElapsed / settleMs)
      const scale = minScale + (1 - minScale) * t
      const dy = startDy + distanceY * t
      setItemSpawnVisual(id, { opacity: 1, dy, scale })
      rafById.set(id, requestAnimationFrame(tick))
      return
    }

    clearItemSpawnVisual(id)
    options.onComplete?.()
  }

  rafById.set(id, requestAnimationFrame(tick))
}
