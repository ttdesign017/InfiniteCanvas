import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../../types/canvas'
import { cropMediaStyle, getCrop } from '../../utils/crop'
import { registerVideoToggle } from '../../utils/videoRegistry'

interface Props {
  item: MediaItem
  selected: boolean
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
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

  const mediaStyle = cropMediaStyle(item)

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
        setInView(hit)
        if (hit) setMediaAttached(true)
      },
      // Start loading slightly before the tile is fully on screen
      { root: null, rootMargin: '120px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Detach decoder when far off-screen (unless playing or selected)
  const keepAttached = mediaAttached && (inView || playing || selected)
  const activeSrc = keepAttached ? item.src : undefined

  const togglePlay = useCallback(() => {
    // Ensure src is attached before play (e.g. spacebar while barely off-screen)
    setMediaAttached(true)
    const v = videoRef.current
    if (!v) {
      // src may attach next paint — retry on next frame
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
      v.pause()
      setPlaying(false)
    }
  }, [item.src])

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
    const onPause = () => setPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('ended', onEnd)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('ended', onEnd)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [activeSrc])

  // Pause when detaching
  useEffect(() => {
    if (keepAttached) return
    const v = videoRef.current
    if (v && !v.paused) v.pause()
    setPlaying(false)
  }, [keepAttached])

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
      {keepAttached ? (
        <video
          ref={videoRef}
          data-playback-id={item.id}
          src={activeSrc}
          loop
          playsInline
          preload="metadata"
          draggable={false}
          className="media-content video-el"
          style={mediaStyle}
        />
      ) : (
        <div
          className="media-content video-el video-lazy-poster"
          style={mediaStyle}
          aria-hidden
        />
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

export function MediaItemView({ item, selected }: Props) {
  const mediaStyle = cropMediaStyle(item)
  const cropped = getCrop(item)
  const isCropped =
    cropped.w < 0.999 ||
    cropped.h < 0.999 ||
    cropped.x > 0.001 ||
    cropped.y > 0.001
  const [showName, setShowName] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Leaving selection hides immediately
    if (!selected) {
      setShowName(false)
      if (hoverTimer.current) {
        clearTimeout(hoverTimer.current)
        hoverTimer.current = null
      }
    }
  }, [selected])

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])

  const onEnter = () => {
    if (!selected || !item.fileName) return
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setShowName(true), 2000)
  }

  const onLeave = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    setShowName(false)
  }

  return (
    <div
      className={`media-item ${selected ? 'is-selected' : ''} type-${item.type} ${item.stacked ? 'is-stacked' : ''}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="media-crop-viewport">
        {item.type === 'video' ? (
          <VideoPlayer item={item} selected={selected} />
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
      {item.fileName && showName && (
        <div className="media-caption top visible" title={item.fileName}>
          {item.fileName}
        </div>
      )}
      {item.type === 'gif' && <span className="media-badge">GIF</span>}
      {isCropped && <span className="media-badge crop-badge">CROP</span>}
    </div>
  )
}
