import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import type { MediaItem } from '../../types/canvas'
import { cropMediaStyle, getCrop } from '../../utils/crop'
import { registerVideoToggle } from '../../utils/videoRegistry'
import {
  captureVideoPosterAfterPaint,
  captureVideoPosterFromElement,
  ensureVideoPoster,
  getVideoPoster,
  getVideoPosterCacheVersion,
  subscribeVideoPosterCache,
} from '../../utils/videoPosterCache'

interface Props {
  item: MediaItem
  selected: boolean
  /**
   * Stack enter/exit peer ghost: never mount a live <video>.
   * Paint cached still (or lazy shell) so remount does not flash.
   */
  staticPreview?: boolean
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function useVideoPoster(itemId: string, src: string): string | null {
  return useSyncExternalStore(
    subscribeVideoPosterCache,
    () => {
      void getVideoPosterCacheVersion()
      return getVideoPoster(itemId, src)
    },
    () => null,
  )
}

/** Always an <img> or gray shell — never an empty <video> (browsers paint that black). */
function VideoStill({
  item,
  mediaStyle,
  className = '',
  ensureIfMissing = false,
}: {
  item: MediaItem
  mediaStyle: CSSProperties
  className?: string
  /** Kick offline capture when ghost has no still yet */
  ensureIfMissing?: boolean
}) {
  const poster = useVideoPoster(item.id, item.src)

  useEffect(() => {
    if (!ensureIfMissing || poster || !item.src) return
    let cancelled = false
    void ensureVideoPoster(item.id, item.src).then(() => {
      if (cancelled) return
    })
    return () => {
      cancelled = true
    }
  }, [ensureIfMissing, poster, item.id, item.src])

  if (poster) {
    return (
      <img
        src={poster}
        alt=""
        draggable={false}
        className={`media-content video-el video-still ${className}`.trim()}
        style={mediaStyle}
      />
    )
  }
  return (
    <div
      className={`media-content video-el video-lazy-poster ${className}`.trim()}
      style={mediaStyle}
      aria-hidden
    />
  )
}

function VideoPlayer({ item, selected }: { item: MediaItem; selected: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hovering, setHovering] = useState(false)
  /**
   * Lazy media: only attach `src` after the player has entered (or neared)
   * the browser viewport. Sticky once true so scrubbing after pan-away still works
   * while selected/playing; otherwise we detach when far off-screen to free decoders.
   */
  const [mediaAttached, setMediaAttached] = useState(false)
  const [inView, setInView] = useState(false)
  /** True once we have a non-black still for this src */
  const hasGoodPosterRef = useRef(Boolean(getVideoPoster(item.id, item.src)))

  const mediaStyle = cropMediaStyle(item)
  const poster = useVideoPoster(item.id, item.src)

  useEffect(() => {
    hasGoodPosterRef.current = Boolean(getVideoPoster(item.id, item.src))
  }, [item.src, item.id])

  useEffect(() => {
    if (poster) hasGoodPosterRef.current = true
  }, [poster])

  const freezeFrame = useCallback(
    (v: HTMLVideoElement, allowOverwrite = false) => {
      const url = captureVideoPosterFromElement(v, item.id, item.src, {
        allowOverwrite,
      })
      if (url) {
        hasGoodPosterRef.current = true
        return Promise.resolve(url)
      }
      return captureVideoPosterAfterPaint(v, item.id, item.src, {
        allowOverwrite,
      }).then((u) => {
        if (u) hasGoodPosterRef.current = true
        return u
      })
    },
    [item.id, item.src],
  )

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setMediaAttached(true)
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting)
        if (!hit) {
          const v = videoRef.current
          if (v && v.readyState >= 2) {
            void freezeFrame(v, true)
          }
        }
        setInView(hit)
        if (hit) setMediaAttached(true)
      },
      { root: null, rootMargin: '120px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [item.id, item.src, freezeFrame])

  // Detach decoder when far off-screen (unless playing or selected)
  const keepAttached = mediaAttached && (inView || playing || selected)
  const activeSrc = keepAttached ? item.src : undefined

  const togglePlay = useCallback(() => {
    setMediaAttached(true)
    const v = videoRef.current
    if (!v) {
      requestAnimationFrame(() => {
        const el = videoRef.current
        if (!el) return
        if (el.paused) void el.play()
      })
      return
    }
    if (!v.src && item.src) {
      v.src = item.src
      v.load()
    }
    if (v.paused) {
      void v.play()
      setPlaying(true)
    } else {
      // Pause first so the decoder holds the current frame, then freeze it
      try {
        v.pause()
      } catch {
        /* ignore */
      }
      setPlaying(false)
      void freezeFrame(v, true)
    }
  }, [item.src, freezeFrame])

  useEffect(() => {
    return registerVideoToggle(item.id, togglePlay)
  }, [item.id, togglePlay])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !activeSrc) return

    const onTime = () => setProgress(v.currentTime)
    const onMeta = () => setDuration(v.duration || 0)
    const onEnd = () => setPlaying(false)
    const onPlay = () => setPlaying(true)
    const onPause = () => {
      setPlaying(false)
      void freezeFrame(v, true)
    }
    const onUsefulFrame = () => {
      // First good frame only unless we already have one — avoid t=0 black lock-in
      void freezeFrame(v, !hasGoodPosterRef.current)
    }

    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('loadeddata', onUsefulFrame)
    v.addEventListener('seeked', onUsefulFrame)
    v.addEventListener('ended', onEnd)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)

    // Nudge off pure black t=0 once metadata is known (paused preview)
    const onMetaSeek = () => {
      if (!v.paused) return
      if (hasGoodPosterRef.current) return
      const dur = Number.isFinite(v.duration) ? v.duration : 0
      if (dur > 0.05 && v.currentTime < 0.001) {
        try {
          v.currentTime = Math.min(0.12, dur * 0.04)
        } catch {
          /* ignore */
        }
      } else {
        void freezeFrame(v, false)
      }
    }
    v.addEventListener('loadedmetadata', onMetaSeek)

    if (v.readyState >= 2) onUsefulFrame()

    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('loadedmetadata', onMetaSeek)
      v.removeEventListener('loadeddata', onUsefulFrame)
      v.removeEventListener('seeked', onUsefulFrame)
      v.removeEventListener('ended', onEnd)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [activeSrc, freezeFrame])

  // Before paint removes the live element, freeze the current frame
  useLayoutEffect(() => {
    if (keepAttached) return
    const v = videoRef.current
    if (v && v.readyState >= 2) {
      void freezeFrame(v, true)
      if (!v.paused) v.pause()
    }
    setPlaying(false)
  }, [keepAttached, freezeFrame])

  const seeking = useRef(false)
  const trackRef = useRef<HTMLDivElement>(null)

  const seekToClientX = useCallback(
    (clientX: number) => {
      const v = videoRef.current
      const track = trackRef.current
      if (!v || !track || !duration) return
      const rect = track.getBoundingClientRect()
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
      v.currentTime = t * duration
      setProgress(v.currentTime)
    },
    [duration],
  )

  const onSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    seeking.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    seekToClientX(e.clientX)
  }

  const onSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seeking.current) return
    e.stopPropagation()
    e.preventDefault()
    seekToClientX(e.clientX)
  }

  const onSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seeking.current) return
    e.stopPropagation()
    seeking.current = false
    const v = videoRef.current
    if (v && v.readyState >= 2) void freezeFrame(v, true)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const showChrome = hovering || !playing || seeking.current
  const pct = duration > 0 ? (progress / duration) * 100 : 0

  return (
    <div
      ref={wrapRef}
      className={`video-player ${selected ? 'is-selected' : ''} ${
        keepAttached ? '' : 'is-lazy'
      }`}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => {
        if (!seeking.current) setHovering(false)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/*
        Never paint <video> without src — browsers show solid black.
        Detached / lazy state always uses <img> still (or gray shell).
      */}
      {keepAttached ? (
        <video
          ref={videoRef}
          data-playback-id={item.id}
          src={activeSrc}
          poster={poster || undefined}
          loop
          playsInline
          preload="auto"
          draggable={false}
          className="media-content video-el"
          style={mediaStyle}
        />
      ) : (
        <VideoStill item={item} mediaStyle={mediaStyle} ensureIfMissing />
      )}

      {showChrome && !playing && (
        <button
          type="button"
          className="video-play-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            togglePlay()
          }}
          aria-label="Play"
        >
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M8 5.5v13l11-6.5-11-6.5z" />
          </svg>
        </button>
      )}

      {showChrome && playing && hovering && (
        <button
          type="button"
          className="video-play-btn dim"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            togglePlay()
          }}
          aria-label="Pause"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        </button>
      )}

      {keepAttached && (
        <div
          className={`video-progress-wrap ${hovering || seeking.current ? 'visible' : ''}`}
          onPointerDown={onSeekPointerDown}
          onPointerMove={onSeekPointerMove}
          onPointerUp={onSeekPointerUp}
          onPointerCancel={onSeekPointerUp}
        >
          <div className="video-progress-track" ref={trackRef}>
            <div className="video-progress-fill" style={{ width: `${pct}%` }} />
            <div className="video-progress-thumb" style={{ left: `${pct}%` }} />
          </div>
          <div className="video-time">
            {formatTime(progress)} / {formatTime(duration)}
          </div>
        </div>
      )}
    </div>
  )
}

const CROP_BADGE_HOVER_MS = 600
const FILENAME_HOVER_MS = 2000

export function MediaItemView({ item, selected, staticPreview = false }: Props) {
  const mediaStyle = cropMediaStyle(item)
  const cropped = getCrop(item)
  const isCropped =
    cropped.w < 0.999 ||
    cropped.h < 0.999 ||
    cropped.x > 0.001 ||
    cropped.y > 0.001
  const [showName, setShowName] = useState(false)
  const [showCropBadge, setShowCropBadge] = useState(false)
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cropTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHoverTimers = () => {
    if (nameTimer.current) {
      clearTimeout(nameTimer.current)
      nameTimer.current = null
    }
    if (cropTimer.current) {
      clearTimeout(cropTimer.current)
      cropTimer.current = null
    }
  }

  useEffect(() => {
    if (!selected) {
      setShowName(false)
      if (nameTimer.current) {
        clearTimeout(nameTimer.current)
        nameTimer.current = null
      }
    }
  }, [selected])

  useEffect(() => {
    return () => clearHoverTimers()
  }, [])

  const onEnter = () => {
    if (staticPreview) return
    if (selected && item.fileName) {
      if (nameTimer.current) clearTimeout(nameTimer.current)
      nameTimer.current = setTimeout(() => setShowName(true), FILENAME_HOVER_MS)
    }
    if (isCropped) {
      if (cropTimer.current) clearTimeout(cropTimer.current)
      cropTimer.current = setTimeout(
        () => setShowCropBadge(true),
        CROP_BADGE_HOVER_MS,
      )
    }
  }

  const onLeave = () => {
    clearHoverTimers()
    setShowName(false)
    setShowCropBadge(false)
  }

  return (
    <div
      className={`media-item ${selected ? 'is-selected' : ''} type-${item.type} ${item.stacked ? 'is-stacked' : ''} ${staticPreview ? 'is-static-preview' : ''}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="media-crop-viewport">
        {item.type === 'video' ? (
          staticPreview ? (
            <div className="video-player is-lazy is-static-preview">
              <VideoStill
                item={item}
                mediaStyle={mediaStyle}
                ensureIfMissing
              />
              <span className="video-play-btn" aria-hidden>
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                  <path d="M8 5.5v13l11-6.5-11-6.5z" />
                </svg>
              </span>
            </div>
          ) : (
            <VideoPlayer item={item} selected={selected} />
          )
        ) : (
          <img
            src={item.src}
            alt={item.fileName || item.type}
            draggable={false}
            className="media-content"
            style={mediaStyle}
          />
        )}
      </div>
      {!staticPreview && item.fileName && showName && (
        <div className="media-caption top visible" title={item.fileName}>
          {item.fileName}
        </div>
      )}
      {!staticPreview && item.type === 'gif' && (
        <span className="media-badge">GIF</span>
      )}
      {!staticPreview && isCropped && showCropBadge && (
        <span className="media-badge crop-badge">CROP</span>
      )}
    </div>
  )
}
