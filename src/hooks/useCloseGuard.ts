import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCanvasStore } from '../store/useCanvasStore'
import * as desktop from '../utils/desktop'
import { saveCurrentBoard } from '../utils/boardIO'
import {
  askUnsavedPrompt,
  UNSAVED_PROMPT_COPY,
} from './unsavedPrompt'

// Re-export dialog API so existing imports from useCloseGuard keep working
export {
  answerClosePrompt,
  askUnsavedPrompt,
  getClosePromptCopy,
  getClosePromptOpen,
  subscribeClosePrompt,
  UNSAVED_PROMPT_COPY,
  type UnsavedPromptChoice,
  type UnsavedPromptCopy,
} from './unsavedPrompt'

async function forceExit() {
  try {
    useCanvasStore.getState().clearDirty()
  } catch {
    /* ignore */
  }
  try {
    await invoke('force_exit_app')
  } catch {
    try {
      await getCurrentWindow().destroy()
    } catch {
      window.close()
    }
  }
}

/**
 * - Block reload shortcuts
 * - Intercept window close with in-app save dialog (never native ask during close)
 * - Force process exit so the app cannot hang
 */
export function useCloseGuard() {
  useEffect(() => {
    const blockReload = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const code = e.code

      if (mod && (key === 'r' || code === 'KeyR')) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (key === 'f5' || code === 'F5') {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener('keydown', blockReload, true)

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!useCanvasStore.getState().dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    let unlistenClose: (() => void) | undefined
    let handling = false

    if (desktop.isDesktop()) {
      void (async () => {
        const win = getCurrentWindow()
        unlistenClose = await win.onCloseRequested(async (event) => {
          // Always take over close — never leave a half-dead window
          event.preventDefault()
          if (handling) return
          handling = true
          try {
            const store = useCanvasStore.getState()
            if (store.dirty) {
              const choice = await askUnsavedPrompt(UNSAVED_PROMPT_COPY.close)
              if (choice === 'cancel') {
                handling = false
                return
              }
              if (choice === 'save') {
                const ok = await saveCurrentBoard()
                if (!ok) {
                  handling = false
                  return
                }
              }
            }
            await forceExit()
          } catch (err) {
            console.error('close handler error', err)
            await forceExit()
          }
        })
      })()
    }

    return () => {
      window.removeEventListener('keydown', blockReload, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
      unlistenClose?.()
    }
  }, [])
}

/** Close button / Ctrl+Q */
export async function requestAppClose(): Promise<void> {
  if (!desktop.isDesktop()) {
    window.close()
    return
  }

  try {
    const store = useCanvasStore.getState()
    if (store.dirty) {
      const choice = await askUnsavedPrompt(UNSAVED_PROMPT_COPY.close)
      if (choice === 'cancel') return
      if (choice === 'save') {
        const ok = await saveCurrentBoard()
        if (!ok) return
      }
    }
    await forceExit()
  } catch (err) {
    console.error('requestAppClose error', err)
    await forceExit()
  }
}
