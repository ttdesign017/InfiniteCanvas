type ToggleFn = () => void

const toggles = new Map<string, ToggleFn>()

export function registerPlaybackToggle(id: string, toggle: ToggleFn) {
  toggles.set(id, toggle)
  return () => {
    if (toggles.get(id) === toggle) toggles.delete(id)
  }
}

function toggleDomMedia(id: string): boolean {
  const el = document.querySelector(
    `[data-playback-id="${CSS.escape(id)}"]`,
  ) as HTMLMediaElement | null
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

/** Backwards-compatible names for the existing video player. */
export const registerVideoToggle = registerPlaybackToggle
export const toggleVideo = togglePlayback
export const toggleVideos = togglePlaybacks
