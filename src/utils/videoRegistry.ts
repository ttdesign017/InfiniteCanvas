type ToggleFn = () => void

const toggles = new Map<string, ToggleFn>()

/** Default frame duration when FPS is unknown (~30fps). */
const DEFAULT_FRAME_STEP_SEC = 1 / 30

export function registerPlaybackToggle(id: string, toggle: ToggleFn) {
  toggles.set(id, toggle)
  return () => {
    if (toggles.get(id) === toggle) toggles.delete(id)
  }
}

function mediaEl(id: string): HTMLMediaElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(
    `[data-playback-id="${CSS.escape(id)}"]`,
  ) as HTMLMediaElement | null
}

function toggleDomMedia(id: string): boolean {
  const el = mediaEl(id)
  if (!el) return false
  if (el.paused) void el.play()
  else el.pause()
  return true
}

export function togglePlayback(id: string): boolean {
  const fn = toggles.get(id)
  if (fn) {
    fn()
    return true
  }
  return toggleDomMedia(id)
}

export function togglePlaybacks(ids: string[]): boolean {
  let any = false
  for (const id of ids) {
    if (togglePlayback(id)) any = true
  }
  return any
}

/**
 * Step a video by one frame (±). Pauses playback first.
 * Uses ~1/30s when the browser does not expose FPS.
 */
export function stepVideoFrame(id: string, direction: -1 | 1): boolean {
  const el = mediaEl(id)
  if (!el || el.tagName !== 'VIDEO') return false
  const video = el as HTMLVideoElement
  if (video.readyState < 1) return false

  try {
    if (!video.paused) video.pause()
  } catch {
    /* ignore */
  }

  const dur = Number.isFinite(video.duration) ? video.duration : Infinity
  const cur = Number.isFinite(video.currentTime) ? video.currentTime : 0
  const next = Math.max(0, Math.min(dur, cur + direction * DEFAULT_FRAME_STEP_SEC))
  // Nudge even at ends so repeated presses near t=0 still "feel" responsive
  if (next === cur && direction < 0 && cur > 0) {
    video.currentTime = 0
  } else if (next !== cur) {
    try {
      video.currentTime = next
    } catch {
      return false
    }
  } else {
    return false
  }
  return true
}

export function stepVideoFrames(ids: string[], direction: -1 | 1): boolean {
  let any = false
  for (const id of ids) {
    if (stepVideoFrame(id, direction)) any = true
  }
  return any
}

/** Backwards-compatible names for the existing video player. */
export const registerVideoToggle = registerPlaybackToggle
export const toggleVideo = togglePlayback
export const toggleVideos = togglePlaybacks
