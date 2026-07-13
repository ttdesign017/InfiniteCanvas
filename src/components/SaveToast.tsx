import { useEffect } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'

/** Brief "Saved" feedback after Ctrl+S / Save As succeeds */
export function SaveToast() {
  const saveNotice = useCanvasStore((s) => s.saveNotice)
  const saveNoticeSeq = useCanvasStore((s) => s.saveNoticeSeq)
  const clearSaveNotice = useCanvasStore((s) => s.clearSaveNotice)

  useEffect(() => {
    if (!saveNotice) return
    const t = window.setTimeout(() => clearSaveNotice(), 1600)
    return () => window.clearTimeout(t)
  }, [saveNotice, saveNoticeSeq, clearSaveNotice])

  if (!saveNotice) return null

  return (
    <div className="save-toast" role="status" aria-live="polite">
      <span className="save-toast-check" aria-hidden>
        ✓
      </span>
      {saveNotice}
    </div>
  )
}
