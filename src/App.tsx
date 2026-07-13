import { Toolbar } from './components/Toolbar'
import { InfiniteCanvas } from './components/InfiniteCanvas'
import { WindowChrome } from './components/WindowChrome'
import { useKeyboard } from './hooks/useKeyboard'
import { useDesktopMenu } from './hooks/useDesktopMenu'
import { useWindowDrag } from './hooks/useWindowDrag'

export default function App() {
  useKeyboard()
  useDesktopMenu()
  useWindowDrag()

  return (
    <div className="app-shell">
      <WindowChrome />
      <main className="workspace">
        <InfiniteCanvas />
        <Toolbar />
      </main>
    </div>
  )
}
