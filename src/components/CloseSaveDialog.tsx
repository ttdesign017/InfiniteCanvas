import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  answerClosePrompt,
  getClosePromptCopy,
  getClosePromptOpen,
  subscribeClosePrompt,
} from '../hooks/unsavedPrompt'

/**
 * In-app save/discard/cancel dialog used on exit and before opening another file.
 * Must NOT use Tauri native dialogs inside onCloseRequested (deadlocks).
 */
export function CloseSaveDialog() {
  const dialogRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const open = useSyncExternalStore(
    subscribeClosePrompt,
    getClosePromptOpen,
    () => false,
  )
  const copy = useSyncExternalStore(
    subscribeClosePrompt,
    getClosePromptCopy,
    getClosePromptCopy,
  )

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => saveRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        answerClosePrompt('cancel')
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
  }, [open])

  if (!open) return null

  return (
    <div
      ref={dialogRef}
      className="close-save-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-save-title"
      aria-describedby="close-save-description"
    >
      <div className="close-save-dialog">
        <h2 id="close-save-title" className="close-save-title">
          {copy.title}
        </h2>
        <p id="close-save-description" className="close-save-body">
          {copy.body}
        </p>
        <div className="close-save-actions">
          <button
            ref={saveRef}
            type="button"
            className="close-save-btn primary"
            onClick={() => answerClosePrompt('save')}
          >
            Save
          </button>
          <button
            type="button"
            className="close-save-btn danger"
            onClick={() => answerClosePrompt('discard')}
          >
            Discard
          </button>
          <button
            type="button"
            className="close-save-btn"
            onClick={() => answerClosePrompt('cancel')}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
