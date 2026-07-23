import { useCanvasStore } from '../store/useCanvasStore'
import { showAppDialog } from './appDialog'

export type UnsavedPromptChoice = 'save' | 'discard' | 'cancel'

export type UnsavedPromptCopy = {
  title: string
  body: string
}

export const UNSAVED_PROMPT_COPY = {
  close: {
    title: 'Save canvas?',
    body: 'This canvas has unsaved changes. Save it as an Infinite Canvas project (.icanvas) before closing?',
  },
  open: {
    title: 'Save canvas?',
    body: 'This canvas has unsaved changes. Save it as an Infinite Canvas project (.icanvas) before opening another file?',
  },
} as const satisfies Record<string, UnsavedPromptCopy>

/**
 * In-app Save / Discard / Cancel dialog (same chrome as all other app modals).
 * Prefer this over native `ask` / `window.confirm` for unsaved-work prompts.
 */
export function askUnsavedPrompt(
  copy: UnsavedPromptCopy = UNSAVED_PROMPT_COPY.close,
): Promise<UnsavedPromptChoice> {
  if (!useCanvasStore.getState().dirty) return Promise.resolve('discard')

  return showAppDialog({
    title: copy.title,
    body: copy.body,
    buttons: [
      { id: 'save', label: 'Save', variant: 'primary' },
      { id: 'discard', label: 'Discard', variant: 'danger' },
      { id: 'cancel', label: 'Cancel' },
    ],
    defaultId: 'save',
    cancelId: 'cancel',
  }).then((id) => {
    if (id === 'save' || id === 'discard' || id === 'cancel') return id
    return 'cancel'
  })
}
