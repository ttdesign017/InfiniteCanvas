/**
 * Remember last playback position per video item so idle (still-only) cards
 * can resume and snapshot at the correct time after the live <video> unmounts.
 */

const lastTimes = new Map<string, number>()

export function rememberPlaybackTime(id: string, timeSec: number): void {
  if (!id) return
  if (!Number.isFinite(timeSec) || timeSec < 0) return
  lastTimes.set(id, timeSec)
}

export function getRememberedPlaybackTime(id: string): number {
  return lastTimes.get(id) ?? 0
}

export function clearRememberedPlaybackTime(id: string): void {
  lastTimes.delete(id)
}

export function clearAllRememberedPlaybackTimes(): void {
  lastTimes.clear()
}

/**
 * Time to seek when remounting a live decoder for resume.
 * If the remembered position is at/near the end, restart from 0 so Space
 * after a finished clip is not a no-op stuck at EOF.
 */
export function resolveResumeTime(
  rememberedSec: number,
  durationSec?: number,
): number {
  if (!Number.isFinite(rememberedSec) || rememberedSec < 0) return 0
  const dur =
    durationSec != null && Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : null
  if (dur != null && rememberedSec >= dur - 0.05) return 0
  return rememberedSec
}

/**
 * Preferred capture time for Shift+C when no live <video> is mounted.
 * Uses remembered time; if never played, nudge past t=0 (often black).
 */
export function preferredSnapshotTime(
  rememberedSec: number,
  durationSec?: number,
): number {
  const dur =
    durationSec != null && Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : null
  if (Number.isFinite(rememberedSec) && rememberedSec > 0.02) {
    if (dur != null) return Math.min(rememberedSec, Math.max(0, dur - 0.001))
    return rememberedSec
  }
  if (dur != null && dur > 0.2) return Math.min(0.15, dur * 0.05)
  if (dur != null && dur > 0) return Math.min(0.05, dur / 2)
  return 0
}
