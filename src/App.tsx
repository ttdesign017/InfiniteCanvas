import { useEffect } from 'react'
import { Toolbar } from './components/Toolbar'
import { InfiniteCanvas } from './components/InfiniteCanvas'
import { EraserCursor } from './components/EraserCursor'
import { WindowChrome } from './components/WindowChrome'
import { CloseSaveDialog } from './components/CloseSaveDialog'
import { SaveToast } from './components/SaveToast'
import { CanvasPath } from './components/CanvasPath'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useCanvasStore } from './store/useCanvasStore'
import { useKeyboard } from './hooks/useKeyboard'
import { useDesktopMenu } from './hooks/useDesktopMenu'
import { useWindowDrag } from './hooks/useWindowDrag'
import { useCloseGuard } from './hooks/useCloseGuard'
import { useAgentBridge } from './hooks/useAgentBridge'
import { getLaunchFilePath, isDesktop } from './utils/desktop'
import { openBoardFromPath } from './utils/boardIO'
import { diagError, diagInfo } from './utils/diagLog'

let launchFileChecked = false

export default function App() {
  useKeyboard()
  useDesktopMenu()
  useWindowDrag()
  useCloseGuard()
  useAgentBridge()
  const immersiveMode = useCanvasStore((s) => s.immersiveMode)

  useEffect(() => {
    if (!isDesktop() || launchFileChecked) return
    launchFileChecked = true
    void getLaunchFilePath()
      .then((path) => {
        if (path) {
          diagInfo('boot', 'Opening launch file', path)
          return openBoardFromPath(path)
        }
      })
      .catch((err) => {
        diagError('boot', 'Launch file open failed', err)
      })
  }, [])

  return (
    <div className={`app-shell ${immersiveMode ? 'is-immersive' : ''}`}>
      <WindowChrome />
      <main className="workspace">
        <ErrorBoundary name="Canvas">
          <InfiniteCanvas />
        </ErrorBoundary>
        <Toolbar />
        <CanvasPath />
        <EraserCursor />
      </main>
      <CloseSaveDialog />
      <SaveToast />
    </div>
  )
}
