import { useEffect } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { createMediaFromPath } from '../utils/media'
import { placeItemsTight, screenToWorld } from '../utils/layout'
import * as desktop from '../utils/desktop'
import { openBoardFromDisk, saveCurrentBoard } from '../utils/boardIO'
import { requestAppClose } from './useCloseGuard'

/** Wire desktop menus / hotkeys that need shell dialogs (Tauri). */
export function useDesktopMenu() {
  useEffect(() => {
    if (!desktop.isDesktop()) return

    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      const code = e.code

      // Never allow reload
      if (key === 'r' || code === 'KeyR') {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      // Save: Ctrl+S
      if (key === 's' && !e.shiftKey) {
        e.preventDefault()
        void saveCurrentBoard()
        return
      }

      // Save As: Ctrl+Shift+S
      if (key === 's' && e.shiftKey) {
        e.preventDefault()
        void saveCurrentBoard({ saveAs: true })
        return
      }

      // Open project: Ctrl+Shift+O
      if (key === 'o' && e.shiftKey) {
        e.preventDefault()
        void openBoardFromDisk()
        return
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** Open media via dialog */
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

export { requestAppClose }
