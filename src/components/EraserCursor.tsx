import { useEffect, useState } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'

/**
 * Screen-space dashed circle matching erase radius (world units × zoom).
 * Shown only while the eraser tool is active.
 */
export function EraserCursor() {
  const tool = useCanvasStore((s) => s.tool)
  const eraseWidth = useCanvasStore((s) => s.eraseWidth)
  const zoom = useCanvasStore((s) => s.viewport.zoom)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [overCanvas, setOverCanvas] = useState(false)

  useEffect(() => {
    if (tool !== 'erase') {
      setPos(null)
      setOverCanvas(false)
      return
    }

    const onMove = (e: PointerEvent) => {
      setPos({ x: e.clientX, y: e.clientY })
      const el = document.elementFromPoint(e.clientX, e.clientY)
      setOverCanvas(!!el?.closest?.('.canvas-surface'))
    }
    const onLeave = () => setOverCanvas(false)

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('blur', onLeave)
    }
  }, [tool])

  if (tool !== 'erase' || !pos || !overCanvas) return null

  const r = Math.max(4, eraseWidth * Math.max(0.05, zoom))
  const d = r * 2

  return (
    <div
      className="eraser-cursor"
      aria-hidden
      style={{
        left: pos.x,
        top: pos.y,
        width: d,
        height: d,
        marginLeft: -r,
        marginTop: -r,
      }}
    />
  )
}
