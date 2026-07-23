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
import {
  getRememberedPlaybackTime,
  rememberPlaybackTime,
  resolveResumeTime,
} from '../../utils/videoPlaybackClock'

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

/** Always an <img> or solid shell — never a blank hole (no picture / transparent). */
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
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    setImgFailed(false)
  }, [poster, item.id, item.src])

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

  // Solid fill always behind content so failed/transparent posters never look empty
  return (
    <>
      <div className="video-media-fallback" aria-hidden />
      {poster && !imgFailed ? (
        <img
          src={poster}
          alt=""
          draggable={false}
          decoding="async"
          className={`media-content video-el video-still ${className}`.trim()}
          style={mediaStyle}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className={`media-content video-el video-lazy-poster ${className}`.trim()}
          style={mediaStyle}
          aria-hidden
        />
      )}
    </>
  )
}

/**
 * Video card: idle always paints a still (`<img>` poster), never a paused
 * live decoder. Selection must NOT force `<video>` — zoom-out with many
 * selected cards was attaching N decoders and WebView2 drops them (blank).
 * Live `<video>` only while playing / scrubbing.
 */
function VideoPlayer({ item, selected }: { item: MediaItem; selected: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hovering, setHovering] = useState(false)
  /** One-shot: kick offline poster capture when near the screen once. */
  const [nearScreen, setNearScreen] = useState(false)
  const nearScreenRef = useRef(false)
  const hasGoodPosterRef = useRef(Boolean(getVideoPoster(item.id, item.src)))
  /** Survives live <video> unmount so Space resumes instead of restarting at 0 */
  const lastTimeRef = useRef(getRememberedPlaybackTime(item.id))
  const durationRef = useRef(0)

  const mediaStyle = cropMediaStyle(item)
  const poster = useVideoPoster(item.id, item.src)

  useEffect(() => {
    lastTimeRef.current = getRememberedPlaybackTime(item.id)
  }, [item.id, item.src])

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

  // Observe only to start poster ensure once — do not toggle live media on zoom.
  // Zoom changes intersection geometry; flipping state every wheel tick was thrashing.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      if (!nearScreenRef.current) {
        nearScreenRef.current = true
        setNearScreen(true)
      }
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting)
        if (!hit || nearScreenRef.current) return
        nearScreenRef.current = true
        setNearScreen(true)
        // Sticky observe goal reached — stop listening (zoom will not re-fire)
        io.disconnect()
      },
      { root: null, rootMargin: '400px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [item.id, item.src])

  // Offline poster when near screen / selected and still missing
  useEffect(() => {
    if ((!nearScreen && !selected) || poster || !item.src) return
    let cancelled = false
    void ensureVideoPoster(item.id, item.src).then(() => {
      if (cancelled) return
    })
    return () => {
      cancelled = true
    }
  }, [nearScreen, selected, poster, item.id, item.src])

  // Live decoder only while the user is actually watching / scrubbing.
  // Never because selected — that made zoom-out blank every selected video.
  const showLive = playing || scrubbing

  const noteTime = useCallback(
    (t: number) => {
      if (!Number.isFinite(t) || t < 0) return
      lastTimeRef.current = t
      rememberPlaybackTime(item.id, t)
      setProgress(t)
    },
    [item.id],
  )

  const applyResumeSeek = useCallback((v: HTMLVideoElement) => {
    const resumeAt = resolveResumeTime(
      lastTimeRef.current,
      durationRef.current ||
        (Number.isFinite(v.duration) ? v.duration : undefined),
    )
    if (resumeAt <= 0.02) return
    if (Math.abs(v.currentTime - resumeAt) < 0.04) return
    try {
      v.currentTime = resumeAt
    } catch {
      /* seek may fail until metadata */
    }
  }, [])

  const togglePlay = useCallback(() => {
    if (!showLive) {
      // Mount video on next paint, restore last time, then play
      setPlaying(true)
      requestAnimationFrame(() => {
        const el = videoRef.current
        if (!el) return
        if (!el.src && item.src) {
          el.src = item.src
          el.load()
        }
        const startPlay = () => {
          applyResumeSeek(el)
          void el.play().catch(() => {
            setPlaying(false)
          })
        }
        if (el.readyState >= 1) startPlay()
        else {
          el.addEventListener('loadedmetadata', startPlay, { once: true })
        }
      })
      return
    }
    const v = videoRef.current
    if (!v) {
      setPlaying(false)
      return
    }
    if (v.paused) {
      applyResumeSeek(v)
      void v.play()
      setPlaying(true)
    } else {
      try {
        v.pause()
      } catch {
        /* ignore */
      }
      noteTime(v.currentTime)
      setPlaying(false)
      void freezeFrame(v, true)
    }
  }, [showLive, item.src, freezeFrame, applyResumeSeek, noteTime])

  useEffect(() => {
    return registerVideoToggle(item.id, togglePlay)
  }, [item.id, togglePlay])

  useEffect(() => {
    if (!showLive) return
    const v = videoRef.current
    if (!v) return

    if (!v.src && item.src) {
      v.src = item.src
      v.load()
    }

    const onTime = () => noteTime(v.currentTime)
    const onMeta = () => {
      const d = v.duration || 0
      durationRef.current = d
      setDuration(d)
      applyResumeSeek(v)
    }
    const onEnd = () => {
      noteTime(v.currentTime)
      setPlaying(false)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => {
      noteTime(v.currentTime)
      setPlaying(false)
      void freezeFrame(v, true)
    }
    const onUsefulFrame = () => {
      void freezeFrame(v, !hasGoodPosterRef.current)
    }

    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('loadeddata', onUsefulFrame)
    v.addEventListener('seeked', onUsefulFrame)
    v.addEventListener('ended', onEnd)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)

    // Only nudge off pure black t=0 when we have no resume position and no poster
    const onMetaSeek = () => {
      if (!v.paused) return
      if (lastTimeRef.current > 0.02) {
        applyResumeSeek(v)
        return
      }
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

    if (v.readyState >= 1) applyResumeSeek(v)
    if (v.readyState >= 2) onUsefulFrame()
    // Resume after mount if we entered via Play (showLive flipped true then rAF)
    if (playing && v.paused) {
      applyResumeSeek(v)
      void v.play().catch(() => setPlaying(false))
    }

    return () => {
      if (Number.isFinite(v.currentTime)) noteTime(v.currentTime)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('loadedmetadata', onMetaSeek)
      v.removeEventListener('loadeddata', onUsefulFrame)
      v.removeEventListener('seeked', onUsefulFrame)
      v.removeEventListener('ended', onEnd)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [showLive, playing, item.src, freezeFrame, noteTime, applyResumeSeek])

  // Leaving live mode: remember time + freeze frame before <video> unmounts
  useLayoutEffect(() => {
    if (showLive) return
    const v = videoRef.current
    if (v) {
      if (Number.isFinite(v.currentTime)) noteTime(v.currentTime)
      if (v.readyState >= 2) {
        void freezeFrame(v, true)
        if (!v.paused) {
          try {
            v.pause()
          } catch {
            /* ignore */
          }
        }
      }
    }
  }, [showLive, freezeFrame, noteTime])

  const trackRef = useRef<HTMLDivElement>(null)

  const seekToClientX = useCallback(
    (clientX: number) => {
      const v = videoRef.current
      const track = trackRef.current
      if (!v || !track || !duration) return
      const rect = track.getBoundingClientRect()
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
      v.currentTime = t * duration
      noteTime(v.currentTime)
    },
    [duration, noteTime],
  )

  const onSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    setScrubbing(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    // Ensure live video is mounted for seek (showLive becomes true via scrubbing)
    requestAnimationFrame(() => seekToClientX(e.clientX))
  }

  const onSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return
    e.stopPropagation()
    e.preventDefault()
    seekToClientX(e.clientX)
  }

  const onSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return
    e.stopPropagation()
    setScrubbing(false)
    const v = videoRef.current
    if (v && v.readyState >= 2) void freezeFrame(v, true)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const showChrome = hovering || !playing || scrubbing
  const pct = duration > 0 ? (progress / duration) * 100 : 0
  // Progress UI when selected/hovering even if idle (still poster) — scrub mounts live
  const showProgress = selected || hovering || showLive
  // Flip only the media plane — chrome (play / scrub) stays upright
  const flipX = !!item.flipX
  const flipY = !!item.flipY
  const mediaFlipStyle: CSSProperties | undefined =
    flipX || flipY
      ? {
          transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
          transformOrigin: 'center center',
        }
      : undefined

  return (
    <div
      ref={wrapRef}
      className={`video-player ${selected ? 'is-selected' : ''} ${
        showLive ? '' : 'is-lazy'
      }`}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => {
        if (!scrubbing) setHovering(false)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/*
        Idle: always still + solid fallback. Live video only while playing/scrubbing.
        Media layer is flipped independently of chrome.
      */}
      <div className="video-media-plane" style={mediaFlipStyle}>
        {(!showLive || poster) && (
          <VideoStill
            item={item}
            mediaStyle={mediaStyle}
            ensureIfMissing
          />
        )}
        {showLive && (
          <video
            ref={videoRef}
            data-playback-id={item.id}
            src={item.src}
            poster={poster || undefined}
            loop
            playsInline
            preload="auto"
            draggable={false}
            className="media-content video-el"
            style={mediaStyle}
          />
        )}
      </div>

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

      {showProgress && (
        <div
          className={`video-progress-wrap ${hovering || scrubbing || selected ? 'visible' : ''}`}
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

  const flipX = !!item.flipX
  const flipY = !!item.flipY
  const mediaFlipStyle: CSSProperties | undefined =
    flipX || flipY
      ? {
          transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
          transformOrigin: 'center center',
        }
      : undefined

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
              <div className="video-media-plane" style={mediaFlipStyle}>
                <VideoStill
                  item={item}
                  mediaStyle={mediaStyle}
                  ensureIfMissing
                />
              </div>
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
            decoding="async"
            loading="eager"
            className="media-content"
            style={{
              ...mediaStyle,
              ...(mediaFlipStyle ?? {}),
            }}
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
