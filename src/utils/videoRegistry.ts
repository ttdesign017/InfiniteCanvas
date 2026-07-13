type ToggleFn = () => void

const toggles = new Map<string, ToggleFn>()

export function registerVideoToggle(id: string, toggle: ToggleFn) {
  toggles.set(id, toggle)
  return () => {
    if (toggles.get(id) === toggle) toggles.delete(id)
  }
}

function toggleDomVideo(id: string): boolean {
  const el = document.querySelector(
    `video[data-video-id="${CSS.escape(id)}"]`,
  ) as HTMLVideoElement | null
  if (!el) return false
  if (el.paused) void el.play()
  else el.pause()
  return true
}

export function toggleVideo(id: string): boolean {
  const fn = toggles.get(id)
  if (fn) {
    fn()
    return true
  }
  return toggleDomVideo(id)
}

export function toggleVideos(ids: string[]): boolean {
  let any = false
  for (const id of ids) {
    if (toggleVideo(id)) any = true
  }
  return any
}
