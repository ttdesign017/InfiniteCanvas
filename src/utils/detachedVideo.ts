/**
 * Load a temporary off-DOM (or off-screen) <video> at a given time for
 * capture / decode work without mounting the canvas player.
 */

function waitEvent(el: HTMLVideoElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.removeEventListener(event, finish)
      resolve()
    }
    el.addEventListener(event, finish)
    window.setTimeout(finish, ms)
  })
}

export type DetachedVideoHandle = {
  video: HTMLVideoElement
  dispose: () => void
}

/**
 * Create a hidden video, load `src`, seek to `timeSec`, wait until a frame
 * is available. Caller must dispose().
 */
export async function openDetachedVideoAtTime(
  src: string,
  timeSec: number,
  options?: { timeoutMs?: number },
): Promise<DetachedVideoHandle | null> {
  if (!src || typeof document === 'undefined') return null
  const timeoutMs = options?.timeoutMs ?? 8000

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  try {
    video.crossOrigin = 'anonymous'
  } catch {
    /* ignore */
  }
  video.style.cssText =
    'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
  document.body.appendChild(video)

  const dispose = () => {
    try {
      video.removeAttribute('src')
      video.load()
      video.remove()
    } catch {
      /* ignore */
    }
  }

  try {
    video.src = src
    video.load()
    await waitEvent(video, 'loadeddata', timeoutMs)
    if (video.videoWidth < 2 || video.readyState < 2) {
      dispose()
      return null
    }

    const dur = Number.isFinite(video.duration) ? video.duration : 0
    let target = Number.isFinite(timeSec) && timeSec > 0 ? timeSec : 0
    if (dur > 0) target = Math.min(Math.max(0, target), Math.max(0, dur - 0.001))

    if (target > 0.001) {
      try {
        video.currentTime = target
        await waitEvent(video, 'seeked', timeoutMs)
      } catch {
        /* some streams reject seek */
      }
    } else {
      // Force a painted frame at t≈0
      try {
        await video.play()
        video.pause()
        await new Promise((r) => requestAnimationFrame(() => r(null)))
      } catch {
        /* autoplay policy */
      }
    }

    if (video.readyState < 2 || video.videoWidth < 2) {
      dispose()
      return null
    }

    return { video, dispose }
  } catch {
    dispose()
    return null
  }
}
