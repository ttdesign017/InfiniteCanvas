import { useEffect } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { toggleVideos } from '../utils/videoRegistry'
import { normalizeUrl } from '../utils/linkMeta'
import { looksLikeUrl } from '../utils/dropImport'
import { screenToWorld } from '../utils/layout'
import {
  collectClipboardMedia,
  openMediaDialog,
  pasteMediaFiles,
} from '../utils/openMedia'
import * as desktop from '../utils/desktop'

/** Only real text editing — NOT color/range/checkbox inputs */
function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.tagName === 'TEXTAREA') return true
  if (target.tagName === 'SELECT') return true
  if (target.tagName === 'INPUT') {
    const type = ((target as HTMLInputElement).type || 'text').toLowerCase()
    // These steal focus after UI use and were incorrectly blocking all shortcuts
    if (
      type === 'color' ||
      type === 'range' ||
      type === 'checkbox' ||
      type === 'radio' ||
      type === 'button' ||
      type === 'submit' ||
      type === 'reset' ||
      type === 'file' ||
      type === 'hidden'
    ) {
      return false
    }
    return true
  }
  return false
}

export function useKeyboard() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore OS key-repeat for held modifiers / tools
      const typing = isTextEditingTarget(e.target)

      // Space: play/pause selected video; otherwise pan
      if ((e.code === 'Space' || e.key === ' ') && !typing) {
        e.preventDefault()
        const store = useCanvasStore.getState()
        const videoIds = store
          .getSelectedItems()
          .filter((i) => i.type === 'video')
          .map((i) => i.id)
        if (videoIds.length > 0) {
          toggleVideos(videoIds)
          return
        }
        store.setSpaceHeld(true)
        return
      }

      // PureRef crop hold — use code so layout/IME doesn't break it
      if (
        !typing &&
        e.code === 'KeyC' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault()
        useCanvasStore.getState().setCHeld(true)
        // don't return — allow nothing else on bare C
        return
      }

      // Always block reload — even while typing (prevents wiping the canvas)
      {
        const modEarly = e.ctrlKey || e.metaKey
        const k = e.key.toLowerCase()
        if (modEarly && (k === 'r' || e.code === 'KeyR')) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (k === 'f5' || e.code === 'F5') {
          e.preventDefault()
          e.stopPropagation()
          return
        }
      }

      if (typing) return

      const store = useCanvasStore.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // Restore crop: Ctrl+Shift+C
      if (mod && e.shiftKey && (key === 'c' || e.code === 'KeyC')) {
        e.preventDefault()
        store.restoreCrop()
        return
      }

      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        store.undo()
        return
      }
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault()
        store.redo()
        return
      }
      if (mod && key === 'a') {
        e.preventDefault()
        store.selectAll()
        return
      }
      // Ctrl+O opens media. Ctrl+Shift+O is reserved for project files.
      if (mod && !e.shiftKey && key === 'o') {
        e.preventDefault()
        void openMediaDialog()
        return
      }
      // Quit app: Ctrl+Q (with save prompt)
      if (mod && !e.altKey && !e.shiftKey && key === 'q') {
        e.preventDefault()
        if (desktop.isDesktop()) {
          void import('./useCloseGuard').then((m) => m.requestAppClose())
        }
        return
      }

      // Stack: Ctrl+G
      if (mod && !e.altKey && !e.shiftKey && key === 'g') {
        e.preventDefault()
        store.quickStack()
        return
      }
      // Unstack / layout: Alt+G
      if (e.altKey && !mod && !e.shiftKey && (key === 'g' || e.code === 'KeyG')) {
        e.preventDefault()
        store.smoothLayout()
        return
      }
      // Fit all content: F or Ctrl+0
      if ((!mod && !e.altKey && !e.shiftKey && (key === 'f' || e.code === 'KeyF')) ||
          (mod && (e.key === '0' || e.code === 'Digit0'))) {
        e.preventDefault()
        store.resetView()
        return
      }

      // Pack / 靠拢: Ctrl+Arrow (closes gaps toward that side — NOT the same as align buttons)
      if (mod && !e.altKey && !e.shiftKey) {
        const code = e.code
        if (
          code === 'ArrowLeft' ||
          code === 'ArrowRight' ||
          code === 'ArrowUp' ||
          code === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown'
        ) {
          e.preventDefault()
          e.stopPropagation()
          const dir =
            code === 'ArrowLeft' || e.key === 'ArrowLeft'
              ? 'left'
              : code === 'ArrowRight' || e.key === 'ArrowRight'
                ? 'right'
                : code === 'ArrowUp' || e.key === 'ArrowUp'
                  ? 'up'
                  : 'down'
          useCanvasStore.getState().packSelected(dir)
          return
        }
      }
      if (mod && (e.key === '=' || e.key === '+' || e.code === 'Equal')) {
        e.preventDefault()
        store.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.15)
        return
      }
      if (mod && (e.key === '-' || e.code === 'Minus')) {
        e.preventDefault()
        store.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.15)
        return
      }

      // Delete / Backspace — also e.code for reliability
      if (
        e.key === 'Delete' ||
        e.key === 'Backspace' ||
        e.code === 'Delete' ||
        e.code === 'Backspace'
      ) {
        e.preventDefault()
        store.deleteSelected()
        return
      }

      if (e.key === 'Escape' || e.code === 'Escape') {
        store.clearSelection()
        store.setTool('select')
        store.setCHeld(false)
        return
      }

      switch (key) {
        case 'v':
          if (!mod) store.setTool('select')
          break
        case 'h':
          store.setTool('pan')
          break
        case 'p':
        case 'b':
          store.setTool('scribble')
          break
        case 'e':
          store.setTool('erase')
          break
        case 't':
          store.setTool('text')
          break
        case 'n':
          store.setTool('textcard')
          break
        case 'l':
          if (!mod) store.setTool('link')
          break
        case ']':
          store.bringToFront()
          break
        case '[':
          store.sendToBack()
          break
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        useCanvasStore.getState().setSpaceHeld(false)
        useCanvasStore.getState().setIsPanning(false)
      }
      if (e.code === 'KeyC' || e.key === 'c' || e.key === 'C') {
        useCanvasStore.getState().setCHeld(false)
      }
    }

    const onBlur = () => {
      useCanvasStore.getState().setSpaceHeld(false)
      useCanvasStore.getState().setCHeld(false)
      useCanvasStore.getState().setIsPanning(false)
    }

    // Guard against duplicate paste handling (capture + bubble / double fire)
    let pasteLockUntil = 0

    const readPasteText = (data: DataTransfer | null): string => {
      if (!data) return ''
      try {
        const plain = data.getData('text/plain')
        if (plain && plain.trim()) return plain.trim()
      } catch {
        /* ignore */
      }
      try {
        const t = data.getData('text')
        if (t && t.trim()) return t.trim()
      } catch {
        /* ignore */
      }
      return ''
    }

    const placePastedText = (raw: string) => {
      const text = raw.trim()
      if (!text) return false
      const store = useCanvasStore.getState()
      const world = screenToWorld(
        window.innerWidth / 2 - 120,
        window.innerHeight / 2 - 60,
        store.viewport,
      )
      if (looksLikeUrl(text)) {
        store.addLinkCard(world, normalizeUrl(text))
      } else {
        store.addTextCard(world, { content: text })
      }
      return true
    }

    const onPaste = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return

      const now = Date.now()
      if (now < pasteLockUntil) {
        e.preventDefault()
        return
      }

      // Read text first (before preventDefault side-effects in some webviews)
      let text = readPasteText(e.clipboardData)
      const mediaFiles = collectClipboardMedia(e.clipboardData).filter(
        (f) => f.size > 0,
      )

      // Prefer real media files when present; otherwise paste text as Note
      if (mediaFiles.length > 0 && !text) {
        e.preventDefault()
        e.stopPropagation()
        pasteLockUntil = now + 400
        void pasteMediaFiles(mediaFiles)
        return
      }

      if (mediaFiles.length > 0 && text) {
        // File Explorer copies often include path as text — prefer media
        const looksLikeFilePath =
          /^[a-zA-Z]:[\\/]/.test(text) ||
          text.includes('\\') ||
          /\.(png|jpe?g|webp|gif|bmp|svg|mp4|webm|mov|mkv|avi)$/i.test(text)
        if (looksLikeFilePath || mediaFiles.some((f) => f.size > 512)) {
          e.preventDefault()
          e.stopPropagation()
          pasteLockUntil = now + 400
          void pasteMediaFiles(mediaFiles)
          return
        }
      }

      if (text) {
        e.preventDefault()
        e.stopPropagation()
        pasteLockUntil = now + 400
        placePastedText(text)
        return
      }

      if (mediaFiles.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        pasteLockUntil = now + 400
        void pasteMediaFiles(mediaFiles)
        return
      }

      // WebView2 fallback: event clipboard sometimes empty for plain text
      e.preventDefault()
      e.stopPropagation()
      pasteLockUntil = now + 400
      void navigator.clipboard
        ?.readText?.()
        .then((t) => {
          if (t && t.trim()) placePastedText(t)
        })
        .catch(() => {
          /* no clipboard permission / empty */
        })
    }

    // Capture phase so shortcuts work even if a child stops bubbling
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    // Capture-only paste — avoid double handling if anything also listens on bubble
    window.addEventListener('paste', onPaste, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('paste', onPaste, true)
    }
  }, [])
}
