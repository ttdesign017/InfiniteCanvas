import { useEffect } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { createMediaFromPath } from '../utils/media'
import { placeItemsTight, screenToWorld } from '../utils/layout'
import * as desktop from '../utils/desktop'

/** Wire desktop menus / hotkeys that need shell dialogs (Tauri). */
export function useDesktopMenu() {
  useEffect(() => {
    if (!desktop.isDesktop()) return

    // No native menu tree like Electron; shortcuts live in useKeyboard.
    // Optional: future global shortcut registration via tauri-plugin-global-shortcut.
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()

      if (key === 's' && !e.shiftKey) {
        e.preventDefault()
        void (async () => {
          const store = useCanvasStore.getState()
          const path = await desktop.saveBoardDialog(`${store.boardName || 'board'}.json`)
          if (!path) return
          const board = store.exportBoard()
          await desktop.writeText(path, JSON.stringify(board, null, 2))
        })()
      }

      if (key === 'o' && e.shiftKey) {
        e.preventDefault()
        void (async () => {
          const path = await desktop.loadBoardDialog()
          if (!path) return
          const text = await desktop.readText(path)
          useCanvasStore.getState().importBoard(JSON.parse(text))
        })()
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** Open media via dialog — used by Ctrl+O path already; keep helper for menus */
export async function desktopOpenMedia() {
  const store = useCanvasStore.getState()
  const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2, store.viewport)
  const ox = center.x - 80
  const oy = center.y - 80
  const paths = await desktop.openMediaDialog()
  if (!paths.length) return
  const raw = []
  let z = store.nextZ
  for (const p of paths) {
    const item = await createMediaFromPath(p, ox, oy, z++)
    if (item) raw.push(item)
  }
  if (raw.length) store.addItems(placeItemsTight(raw, ox, oy, 4))
}
