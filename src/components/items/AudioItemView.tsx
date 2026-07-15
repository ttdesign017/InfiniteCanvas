import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AudioItem } from '../../types/canvas'
import { registerPlaybackToggle } from '../../utils/videoRegistry'

interface Props {
  item: AudioItem
  selected: boolean
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="5" y="4" width="3.5" height="12" rx="1" />
      <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.3 4.1a1 1 0 0 1 1.5-.84l7.5 5.9a1.06 1.06 0 0 1 0 1.68l-7.5 5.9a1 1 0 0 1-1.5-.84V4.1Z" />
    </svg>
  )
}

export function AudioItemView({ item, selected }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const frameRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [failed, setFailed] = useState(false)

  const title = useMemo(() => {
    const raw = item.fileName?.trim() || 'Untitled audio'
    return raw.replace(/\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aiff?|aif)$/i, '')
  }, [item.fileName])

  const format = useMemo(() => {
    const ext = item.fileName?.split('.').pop()?.toUpperCase()
    return ext && ext.length <= 5 ? ext : 'AUDIO'
  }, [item.fileName])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || failed) return
    if (audio.paused) {
      void audio.play().catch(() => setFailed(true))
    } else {
      audio.pause()
    }
  }, [failed])

  useEffect(
    () => registerPlaybackToggle(item.id, togglePlay),
    [item.id, togglePlay],
  )

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
      setFailed(false)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(audio.duration || 0)
    }
    const onError = () => setFailed(true)
    audio.addEventListener('loadedmetadata', onMetadata)
    audio.addEventListener('durationchange', onMetadata)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    return () => {
      audio.removeEventListener('loadedmetadata', onMetadata)
      audio.removeEventListener('durationchange', onMetadata)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [item.src])

  useEffect(() => {
    cancelAnimationFrame(frameRef.current)
    if (!playing) {
      const audio = audioRef.current
      if (audio) setCurrentTime(audio.currentTime)
      return
    }
    const update = () => {
      const audio = audioRef.current
      if (!audio || audio.paused) return
      setCurrentTime(audio.currentTime)
      frameRef.current = requestAnimationFrame(update)
    }
    frameRef.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frameRef.current)
  }, [playing])

  return (
    <div
      className={`audio-island-shell ${selected ? 'is-selected' : ''}`}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <audio
        ref={audioRef}
        data-playback-id={item.id}
        src={item.src}
        preload="metadata"
      />

      <div className="audio-island-surface" aria-hidden="true" />

      <div className="audio-island-panel">
        <button
          type="button"
          className="audio-play-button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            togglePlay()
          }}
          aria-label={failed ? 'Audio unavailable' : playing ? 'Pause audio' : 'Play audio'}
          disabled={failed}
        >
          <PlayIcon playing={playing} />
        </button>

        <div className="audio-island-content">
          <div className="audio-island-meta">
            <span className="audio-island-title" title={item.fileName}>{title}</span>
            <span className="audio-island-format">{failed ? 'UNAVAILABLE' : format}</span>
          </div>
          <div className="audio-island-timeline">
            <input
              type="range"
              min="0"
              max={Math.max(duration, 0.01)}
              step="0.01"
              value={Math.min(currentTime, Math.max(duration, 0.01))}
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onPointerUp={(event) => {
                event.stopPropagation()
              }}
              onChange={(event) => {
                const next = Number(event.currentTarget.value)
                if (audioRef.current) audioRef.current.currentTime = next
                setCurrentTime(next)
              }}
              aria-label={`Seek ${title}`}
              disabled={!duration || failed}
            />
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
