/**
 * In-app modal dialogs (alert / confirm / multi-button).
 * Prefer these over `window.alert`, `window.confirm`, and Tauri `ask()` so all
 * prompts share the same chrome as the save-before-close dialog.
 */

export type AppDialogButtonVariant = 'primary' | 'danger' | 'default'

export type AppDialogButton = {
  id: string
  label: string
  variant?: AppDialogButtonVariant
}

export type AppDialogRequest = {
  title: string
  body: string
  buttons: AppDialogButton[]
  /** Button focused when the dialog opens (and activated by Enter). */
  defaultId?: string
  /** Button activated by Escape; defaults to last non-primary if any. */
  cancelId?: string
}

type AppDialogState = {
  open: boolean
  title: string
  body: string
  buttons: AppDialogButton[]
  defaultId: string
  cancelId: string | null
  resolve: ((id: string) => void) | null
}

const state: AppDialogState = {
  open: false,
  title: '',
  body: '',
  buttons: [],
  defaultId: 'ok',
  cancelId: null,
  resolve: null,
}

export type AppDialogSnapshot = {
  open: boolean
  title: string
  body: string
  buttons: AppDialogButton[]
  defaultId: string
  cancelId: string | null
}

/**
 * Cached snapshot for useSyncExternalStore.
 * MUST return a stable reference when nothing changed — a fresh object every
 * getSnapshot call causes "Maximum update depth exceeded".
 */
let snapshot: AppDialogSnapshot = {
  open: false,
  title: '',
  body: '',
  buttons: [],
  defaultId: 'ok',
  cancelId: null,
}

const listeners = new Set<() => void>()

function refreshSnapshot() {
  snapshot = {
    open: state.open,
    title: state.title,
    body: state.body,
    buttons: state.buttons,
    defaultId: state.defaultId,
    cancelId: state.cancelId,
  }
}

function emit() {
  refreshSnapshot()
  listeners.forEach((l) => l())
}

export function subscribeAppDialog(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function getAppDialogOpen() {
  return state.open
}

export function getAppDialogSnapshot(): AppDialogSnapshot {
  return snapshot
}

export function answerAppDialog(id: string) {
  if (!state.open) return
  state.open = false
  const r = state.resolve
  state.resolve = null
  emit()
  r?.(id)
}

/**
 * Show a modal and resolve with the chosen button id.
 * If another dialog is already open, its waiter is resolved with its cancel id
 * (or first button) so callers never hang.
 */
export function showAppDialog(req: AppDialogRequest): Promise<string> {
  const buttons =
    req.buttons.length > 0
      ? req.buttons
      : [{ id: 'ok', label: 'OK', variant: 'primary' as const }]
  const defaultId =
    req.defaultId && buttons.some((b) => b.id === req.defaultId)
      ? req.defaultId
      : buttons.find((b) => b.variant === 'primary')?.id ?? buttons[0].id
  const cancelId =
    req.cancelId && buttons.some((b) => b.id === req.cancelId)
      ? req.cancelId
      : buttons.find((b) => b.variant !== 'primary' && b.variant !== 'danger')
          ?.id ??
        buttons[buttons.length - 1]?.id ??
        null

  if (state.resolve) {
    const prev = state.resolve
    state.resolve = null
    prev(state.cancelId ?? state.defaultId)
  }

  return new Promise((resolve) => {
    state.open = true
    state.title = req.title
    state.body = req.body
    state.buttons = buttons
    state.defaultId = defaultId
    state.cancelId = cancelId
    state.resolve = resolve
    emit()
  })
}

/** Simple OK alert (replaces `window.alert`). */
export async function showAppAlert(
  body: string,
  title = 'Infinite Canvas',
): Promise<void> {
  await showAppDialog({
    title,
    body,
    buttons: [{ id: 'ok', label: 'OK', variant: 'primary' }],
    defaultId: 'ok',
    cancelId: 'ok',
  })
}

/** Yes / No confirm (replaces `window.confirm` / Tauri `ask`). */
export async function showAppConfirm(
  body: string,
  title = 'Infinite Canvas',
  options?: { yesLabel?: string; noLabel?: string },
): Promise<boolean> {
  const id = await showAppDialog({
    title,
    body,
    buttons: [
      { id: 'yes', label: options?.yesLabel ?? 'Yes', variant: 'primary' },
      { id: 'no', label: options?.noLabel ?? 'No' },
    ],
    defaultId: 'yes',
    cancelId: 'no',
  })
  return id === 'yes'
}
