import { useEffect, useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/useCanvasStore'
import { worldRectFromViewport } from '../../utils/viewportCull'
import type { BoundsRect } from '../../utils/geometry'

/**
 * Expanded world-space frustum for paint culling.
 * Subscribes to viewport — intentional re-render on pan/zoom to remount offscreen media.
 */
export function useWorldCullRect(options?: {
  /** Disable culling (return null → show all). */
  disabled?: boolean
  marginPx?: number
}): BoundsRect | null {
  const disabled = options?.disabled === true
  const marginPx = options?.marginPx ?? 240
  const viewport = useCanvasStore((s) => s.viewport)
  const [screen, setScreen] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  }))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () =>
      setScreen({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return useMemo(() => {
    if (disabled) return null
    return worldRectFromViewport(viewport, screen.w, screen.h, marginPx)
  }, [disabled, viewport, screen.w, screen.h, marginPx])
}
