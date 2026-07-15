import { useCallback, useEffect, useRef } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'

/**
 * Push undo history at most once per gesture / edit session.
 *
 * Reset when `resetKey` changes (e.g. selection id list, `editing` flag).
 * Use for continuous controls (color drag, size slider) and text typing so
 * Ctrl+Z undoes the whole session instead of each intermediate frame.
 */
export function useHistoryOnce(resetKey: string | number | boolean | null): () => void {
  const pushed = useRef(false)

  useEffect(() => {
    pushed.current = false
  }, [resetKey])

  return useCallback(() => {
    if (pushed.current) return
    pushed.current = true
    useCanvasStore.getState().pushHistory()
  }, [])
}
