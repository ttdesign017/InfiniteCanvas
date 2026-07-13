import { useEffect } from 'react'
import * as desktop from '../utils/desktop'

/**
 * Hold right mouse button and drag to move the frameless Tauri window.
 * Middle-click remains for canvas pan.
 */
export function useWindowDrag() {
  useEffect(() => {
    if (!desktop.isDesktop()) return

    let active = false

    const onDown = (e: PointerEvent) => {
      if (e.button !== 2) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, button, a, [contenteditable="true"]')) {
        return
      }
      e.preventDefault()
      active = true
      desktop.windowMoveStart(e.screenX, e.screenY)
      try {
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      } catch {
        /* ignore */
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!active) return
      // screen coords = CSS/logical px; desktop converts to match window bounds
      desktop.windowMoveTo(e.screenX, e.screenY)
    }

    const onUp = (e: PointerEvent) => {
      if (!active) return
      if (e.button !== 2 && e.type !== 'pointercancel') return
      active = false
      desktop.windowMoveEnd()
    }

    const onContextMenu = (e: MouseEvent) => {
      // Allow native menu only on editable fields
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
    }

    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('contextmenu', onContextMenu, true)

    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [])
}
