import { useEffect, useRef, type RefObject } from 'react'

/**
 * When `active` becomes true, focus `elRef` and keep focus through the tail of
 * the pointer gesture that created/opened the editor (canvas pointerup often
 * steals focus right after mount).
 *
 * Returns `onBlur` that ignores spurious blurs for a short arm window.
 */
export function useAutoFocusEdit(
  active: boolean,
  elRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>,
  onEndEdit: () => void,
) {
  const armUntilRef = useRef(0)

  useEffect(() => {
    if (!active) return
    const el = elRef.current
    if (!el) return

    armUntilRef.current = performance.now() + 200
    let cancelled = false

    const focusNow = () => {
      if (cancelled) return
      const node = elRef.current
      if (!node) return
      if (document.activeElement === node) return
      try {
        node.focus({ preventScroll: true })
      } catch {
        node.focus()
      }
    }

    // Immediate + after paint + after the creating pointerup settles.
    focusNow()
    const raf = requestAnimationFrame(() => {
      focusNow()
      requestAnimationFrame(focusNow)
    })
    const t0 = window.setTimeout(focusNow, 0)
    const t1 = window.setTimeout(focusNow, 32)
    const onPointerUp = () => {
      armUntilRef.current = Math.max(armUntilRef.current, performance.now() + 80)
      focusNow()
    }
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.clearTimeout(t0)
      window.clearTimeout(t1)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
    }
  }, [active, elRef])

  const onBlur = () => {
    if (performance.now() < armUntilRef.current) {
      // Reclaim focus from canvas / body after the create click.
      requestAnimationFrame(() => {
        if (performance.now() < armUntilRef.current) {
          elRef.current?.focus({ preventScroll: true })
        }
      })
      return
    }
    onEndEdit()
  }

  return { onBlur }
}
