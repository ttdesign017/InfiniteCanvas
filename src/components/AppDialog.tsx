import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  answerAppDialog,
  getAppDialogSnapshot,
  subscribeAppDialog,
  type AppDialogButtonVariant,
} from '../hooks/appDialog'

function btnClass(variant: AppDialogButtonVariant | undefined): string {
  if (variant === 'primary') return 'app-dialog-btn primary'
  if (variant === 'danger') return 'app-dialog-btn danger'
  return 'app-dialog-btn'
}

/**
 * Shared in-app modal chrome (same visual language as the former CloseSaveDialog).
 * Hosted once at app root; driven by `showAppDialog` / `showAppAlert` / etc.
 */
export function AppDialog() {
  const dialogRef = useRef<HTMLDivElement>(null)
  const defaultBtnRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const snap = useSyncExternalStore(
    subscribeAppDialog,
    getAppDialogSnapshot,
    getAppDialogSnapshot,
  )

  useEffect(() => {
    if (!snap.open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => defaultBtnRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        answerAppDialog(snap.cancelId ?? snap.defaultId)
        return
      }
      if (event.key === 'Enter') {
        const tag = (event.target as HTMLElement | null)?.tagName
        if (tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA') return
        event.preventDefault()
        event.stopPropagation()
        answerAppDialog(snap.defaultId)
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown, true)
      previousFocusRef.current?.focus()
    }
  }, [snap.open, snap.cancelId, snap.defaultId])

  if (!snap.open) return null

  return (
    <div
      ref={dialogRef}
      className="app-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-dialog-title"
      aria-describedby="app-dialog-description"
    >
      <div className="app-dialog">
        <h2 id="app-dialog-title" className="app-dialog-title">
          {snap.title}
        </h2>
        <p id="app-dialog-description" className="app-dialog-body">
          {snap.body}
        </p>
        <div className="app-dialog-actions">
          {snap.buttons.map((btn) => (
            <button
              key={btn.id}
              ref={btn.id === snap.defaultId ? defaultBtnRef : undefined}
              type="button"
              className={btnClass(btn.variant)}
              onClick={() => answerAppDialog(btn.id)}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
