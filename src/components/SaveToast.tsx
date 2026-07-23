import { useEffect } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'

/** Save progress bar + brief "Saved" / hint feedback after Ctrl+S / Save As */
export function SaveToast() {
  const isSaving = useCanvasStore((s) => s.isSaving)
  const saveNotice = useCanvasStore((s) => s.saveNotice)
  const saveNoticeSeq = useCanvasStore((s) => s.saveNoticeSeq)
  const clearSaveNotice = useCanvasStore((s) => s.clearSaveNotice)

  useEffect(() => {
    if (!saveNotice || isSaving) return
    // Longer for instructional hints (e.g. crop + rotation)
    const ms = saveNotice.length > 12 ? 2800 : 1600
    const t = window.setTimeout(() => clearSaveNotice(), ms)
    return () => window.clearTimeout(t)
  }, [saveNotice, saveNoticeSeq, isSaving, clearSaveNotice])

  if (isSaving) {
    return (
      <div
        className="save-toast is-saving"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="save-toast-label">Saving…</span>
        <span className="save-progress" aria-hidden>
          <span className="save-progress-bar" />
        </span>
      </div>
    )
  }

  if (!saveNotice) return null

  const isHint = saveNotice !== 'Saved' && !saveNotice.startsWith('Saved')

  return (
    <div
      className={`save-toast ${isHint ? 'is-hint' : ''}`}
      role="status"
      aria-live="polite"
    >
      {!isHint && (
        <span className="save-toast-check" aria-hidden>
          ✓
        </span>
      )}
      {saveNotice}
    </div>
  )
}
