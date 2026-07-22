import { useCanvasStore } from '../store/useCanvasStore'

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

/** In-app save dialog state (native ask() deadlocks inside onCloseRequested) */
type UnsavedPromptState = {
  open: boolean
  copy: UnsavedPromptCopy
  resolve: ((v: UnsavedPromptChoice) => void) | null
}

const promptState: UnsavedPromptState = {
  open: false,
  copy: UNSAVED_PROMPT_COPY.close,
  resolve: null,
}

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function subscribeClosePrompt(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function getClosePromptOpen() {
  return promptState.open
}

export function getClosePromptCopy(): UnsavedPromptCopy {
  return promptState.copy
}

export function answerClosePrompt(v: UnsavedPromptChoice) {
  promptState.open = false
  const r = promptState.resolve
  promptState.resolve = null
  emit()
  r?.(v)
}

/**
 * In-app Save / Discard / Cancel dialog (same chrome for exit, open-file, etc.).
 * Prefer this over native `ask` / `window.confirm` for unsaved-work prompts.
 */
export function askUnsavedPrompt(
  copy: UnsavedPromptCopy = UNSAVED_PROMPT_COPY.close,
): Promise<UnsavedPromptChoice> {
  if (!useCanvasStore.getState().dirty) return Promise.resolve('discard')

  // If a prompt is already open, cancel the previous waiter so we don't hang
  if (promptState.resolve) {
    const prev = promptState.resolve
    promptState.resolve = null
    prev('cancel')
  }

  return new Promise((resolve) => {
    promptState.open = true
    promptState.copy = copy
    promptState.resolve = resolve
    emit()
  })
}
