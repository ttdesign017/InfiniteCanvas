import { useEffect } from 'react'
import { Toolbar } from './components/Toolbar'
import { InfiniteCanvas } from './components/InfiniteCanvas'
import { WindowChrome } from './components/WindowChrome'
import { CloseSaveDialog } from './components/CloseSaveDialog'
import { SaveToast } from './components/SaveToast'
import { CanvasPath } from './components/CanvasPath'
import { useCanvasStore } from './store/useCanvasStore'
import { useKeyboard } from './hooks/useKeyboard'
import { useDesktopMenu } from './hooks/useDesktopMenu'
import { useWindowDrag } from './hooks/useWindowDrag'
import { useCloseGuard } from './hooks/useCloseGuard'
import { getLaunchFilePath, isDesktop } from './utils/desktop'
import { openBoardFromPath } from './utils/boardIO'

let launchFileChecked = false

export default function App() {
  useKeyboard()
  useDesktopMenu()
  useWindowDrag()
  useCloseGuard()
  const immersiveMode = useCanvasStore((s) => s.immersiveMode)

  useEffect(() => {
    if (!isDesktop() || launchFileChecked) return
    launchFileChecked = true
    void getLaunchFilePath().then((path) => {
      if (path) void openBoardFromPath(path)
    })
  }, [])

  return (
    <div className={`app-shell ${immersiveMode ? 'is-immersive' : ''}`}>
      <WindowChrome />
      <main className="workspace">
        <InfiniteCanvas />
        <Toolbar />
        <CanvasPath />
      </main>
      <CloseSaveDialog />
      <SaveToast />
    </div>
  )
}
