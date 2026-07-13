import { useEffect, useState } from 'react'
import * as desktop from '../utils/desktop'

/** Frameless window controls — minimal icons, visible only near top edge */
export function WindowChrome() {
  const [show, setShow] = useState(false)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    setShow(desktop.isDesktop())
    if (desktop.isDesktop()) {
      void desktop.windowIsMaximized().then(setMaximized)
    }
  }, [])

  if (!show) return null

  return (
    <div className="window-chrome-hit" aria-hidden={false}>
      <div className="window-controls">
        <button
          type="button"
          className="win-btn"
          title="Minimize"
          onClick={() => void desktop.windowMinimize()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="win-btn"
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={async () => {
            const next = await desktop.windowToggleMaximize()
            setMaximized(next)
          }}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3.5 4.5h5v5h-5v-5zM4.5 3.5h5v5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect
                x="2.5"
                y="2.5"
                width="7"
                height="7"
                stroke="currentColor"
                strokeWidth="1.2"
                rx="0.5"
              />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="win-btn win-btn-close"
          title="Close"
          onClick={() => void desktop.windowClose()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 3l6 6M9 3L3 9"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
