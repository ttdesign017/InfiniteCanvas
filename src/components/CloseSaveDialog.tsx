import { useSyncExternalStore } from 'react'
import {
  answerClosePrompt,
  getClosePromptOpen,
  subscribeClosePrompt,
} from '../hooks/useCloseGuard'

/**
 * In-app save/discard/cancel dialog used on exit.
 * Must NOT use Tauri native dialogs inside onCloseRequested (deadlocks).
 */
export function CloseSaveDialog() {
  const open = useSyncExternalStore(
    subscribeClosePrompt,
    getClosePromptOpen,
    () => false,
  )

  if (!open) return null

  return (
    <div className="close-save-overlay" role="dialog" aria-modal="true">
      <div className="close-save-dialog">
        <h2 className="close-save-title">Save canvas?</h2>
        <p className="close-save-body">
          This canvas has unsaved changes. Save it as an Infinite Canvas project
          (.icanvas) before closing?
        </p>
        <div className="close-save-actions">
          <button
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
            Don't Save
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
