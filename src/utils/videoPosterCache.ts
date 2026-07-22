/**
 * Session cache of still frames for video items.
 * Used as:
 * - ghost/static peers during stack enter/exit (no live <video> remount flash)
 * - lazy poster when the real player detaches the decoder
 */

const posters = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

/** In-flight ensure loads so we don't spawn parallel hidden videos per item. */
const ensureInflight = new Map<string, Promise<string | null>>()

function emit() {
  version += 1
  listeners.forEach((l) => l())
}

export function videoPosterCacheKey(itemId: string, src?: string): string {
  return src ? `${itemId}::${src}` : itemId
}

export function getVideoPoster(itemId: string, src?: string): string | null {
  if (src) {
    const byBoth = posters.get(videoPosterCacheKey(itemId, src))
    if (byBoth) return byBoth
  }
  return posters.get(itemId) ?? null
}

export function setVideoPoster(
  itemId: string,
  dataUrl: string,
  src?: string,
): void {
  if (!dataUrl.startsWith('data:image/')) return
  const prev = getVideoPoster(itemId, src)
  posters.set(itemId, dataUrl)
  if (src) posters.set(videoPosterCacheKey(itemId, src), dataUrl)
  if (prev !== dataUrl) emit()
}

export function clearVideoPosterCache(): void {
  if (posters.size === 0) return
  posters.clear()
  emit()
}

export function videoPosterCacheSize(): number {
  return posters.size
}

export function subscribeVideoPosterCache(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Snapshot for useSyncExternalStore. */
export function getVideoPosterCacheVersion(): number {
  return version
}

/**
 * Sample canvas pixels — reject near-black frames (common at t=0 before decode paints).
 */
export function isMostlyBlackImageData(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): boolean {
  if (w < 1 || h < 1) return true
  try {
    const stepX = Math.max(1, Math.floor(w / 8))
    const stepY = Math.max(1, Math.floor(h / 8))
    let sum = 0
    let n = 0
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        const d = ctx.getImageData(x, y, 1, 1).data
        // Relative luminance
        sum += 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]
        n++
      }
    }
    if (n === 0) return true
    return sum / n < 12
  } catch {
    // getImageData can throw if tainted — treat as unusable
    return true
  }
}

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

/**
 * Capture a JPEG still from a decoded <video> into the poster cache.
 * Rejects empty/black frames so we never lock in a useless poster.
 */
export function captureVideoPosterFromElement(
  video: HTMLVideoElement,
  itemId: string,
  src?: string,
  options?: { allowOverwrite?: boolean },
): string | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (vw < 2 || vh < 2) return null
  // Need a current frame — HAVE_CURRENT_DATA or better
  if (video.readyState < 2) return null

  try {
    const maxEdge = 640
    let w = vw
    let h = vh
    if (Math.max(w, h) > maxEdge) {
      const s = maxEdge / Math.max(w, h)
      w = Math.max(1, Math.round(w * s))
      h = Math.max(1, Math.round(h * s))
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)

    if (isMostlyBlackImageData(ctx, w, h)) {
      return null
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
    if (!dataUrl.startsWith('data:image/')) return null

    const prev = getVideoPoster(itemId, src)
    // Don't replace a good still with another unless forced (e.g. after scrub)
    if (prev && !options?.allowOverwrite) {
      return prev
    }
    setVideoPoster(itemId, dataUrl, src)
    return dataUrl
  } catch {
    return null
  }
}

/**
 * Capture after the browser has painted the current frame (double rAF + optional rvfc).
 */
export function captureVideoPosterAfterPaint(
  video: HTMLVideoElement,
  itemId: string,
  src?: string,
  options?: { allowOverwrite?: boolean },
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const run = () => {
      if (settled) return
      settled = true
      resolve(captureVideoPosterFromElement(video, itemId, src, options))
    }
    const vfc = (
      video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number
      }
    ).requestVideoFrameCallback
    if (typeof vfc === 'function') {
      vfc.call(video, () => {
        requestAnimationFrame(run)
      })
      // Safety if rvfc never fires (paused/stalled)
      window.setTimeout(run, 160)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(run))
  })
}

/**
 * Offline ensure: load src in a hidden video, seek past t=0 (avoids pure black),
 * capture a still. Used when ghost needs a frame that was never cached.
 */
export async function ensureVideoPoster(
  itemId: string,
  src: string,
): Promise<string | null> {
  if (!src) return null
  const existing = getVideoPoster(itemId, src)
  if (existing) return existing

  const key = videoPosterCacheKey(itemId, src)
  const inflight = ensureInflight.get(key)
  if (inflight) return inflight

  const job = (async () => {
    if (typeof document === 'undefined') return null
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
    document.body.appendChild(video)

    try {
      video.src = src
      video.load()
      await waitEvent(video, 'loadeddata', 8000)
      if (video.videoWidth < 2) return null

      // t=0 is often black; nudge to a real frame when possible
      const dur = Number.isFinite(video.duration) ? video.duration : 0
      const target =
        dur > 0.2 ? Math.min(0.15, dur * 0.05) : dur > 0 ? Math.min(0.05, dur / 2) : 0
      if (target > 0) {
        try {
          video.currentTime = target
          await waitEvent(video, 'seeked', 4000)
        } catch {
          /* seek may fail on some streams */
        }
      } else {
        // Try play/pause to force a painted frame
        try {
          await video.play()
          video.pause()
          await new Promise((r) => requestAnimationFrame(() => r(null)))
        } catch {
          /* autoplay policy */
        }
      }

      let url = captureVideoPosterFromElement(video, itemId, src, {
        allowOverwrite: true,
      })
      if (!url) {
        url = await captureVideoPosterAfterPaint(video, itemId, src, {
          allowOverwrite: true,
        })
      }
      return url
    } catch {
      return null
    } finally {
      try {
        video.removeAttribute('src')
        video.load()
        video.remove()
      } catch {
        /* ignore */
      }
      ensureInflight.delete(key)
    }
  })()

  ensureInflight.set(key, job)
  return job
}
