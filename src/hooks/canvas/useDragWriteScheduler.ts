import { useCallback, useRef } from 'react'

/**
 * Coalesce high-frequency drag/resize store writes to one per animation frame.
 */
export function useDragWriteScheduler() {
  const dragRafRef = useRef(0)
  const pendingDragWriteRef = useRef<(() => void) | null>(null)

  const scheduleDragWrite = useCallback((fn: () => void) => {
    pendingDragWriteRef.current = fn
    if (dragRafRef.current) return
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = 0
      const run = pendingDragWriteRef.current
      pendingDragWriteRef.current = null
      run?.()
    })
  }, [])

  const flushDragWrite = useCallback(() => {
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = 0
    }
    const run = pendingDragWriteRef.current
    pendingDragWriteRef.current = null
    run?.()
  }, [])

  return { scheduleDragWrite, flushDragWrite }
}
