import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import type { Tool } from '../types/canvas'
import type { AlignMode } from '../utils/align'
import { StyleInspector } from './style/StyleInspector'

const tools: Array<{ id: Tool; label: string; hint: string; icon: string }> = [
  { id: 'select', label: 'Select', hint: 'V', icon: 'cursor' },
  { id: 'pan', label: 'Pan', hint: 'H', icon: 'hand' },
  { id: 'scribble', label: 'Draw', hint: 'P', icon: 'pen' },
  { id: 'erase', label: 'Erase', hint: 'E', icon: 'erase' },
  { id: 'text', label: 'Text', hint: 'T', icon: 'text' },
  { id: 'textcard', label: 'Note', hint: 'N', icon: 'note' },
  { id: 'link', label: 'Link', hint: 'L', icon: 'link' },
]

function Icon({ name }: { name: string }) {
  switch (name) {
    case 'cursor':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5 3l14 8.5-6.2 1.4L9.5 21 5 3z" strokeLinejoin="round" />
        </svg>
      )
    case 'hand':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M8 11V6.5a1.5 1.5 0 013 0V11M11 10V5.5a1.5 1.5 0 013 0V11M14 10.5V7a1.5 1.5 0 013 0v7.5c0 3-2 5.5-5.5 5.5S6 17.5 6 14.5V11a1.5 1.5 0 013 0v2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'pen':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 20l4.5-1.2L19 8.3a2.1 2.1 0 00-3-3L5.5 15.8 4 20z" strokeLinejoin="round" />
          <path d="M13.5 6.5l3 3" />
        </svg>
      )
    case 'erase':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M16.5 4.5l3 3-9.8 9.8H6.7l-3-3L16.5 4.5z" strokeLinejoin="round" />
          <path d="M5 20h14" strokeLinecap="round" />
        </svg>
      )
    case 'text':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5 6h14M12 6v12M9 18h6" strokeLinecap="round" />
        </svg>
      )
    case 'note':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="5" y="4" width="14" height="16" rx="2.5" />
          <path d="M8 9h8M8 13h6" strokeLinecap="round" />
        </svg>
      )
    case 'link':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M10 13a5 5 0 007.07 0l1.4-1.4a5 5 0 00-7.07-7.07L10 5.9" strokeLinecap="round" />
          <path d="M14 11a5 5 0 00-7.07 0L5.5 12.4a5 5 0 007.07 7.07L14 18.1" strokeLinecap="round" />
        </svg>
      )
    default:
      return null
  }
}

const alignHorizontal: Array<{ mode: AlignMode; title: string; icon: ReactNode }> = [
  {
    mode: 'left',
    title: 'Align left',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 4v16M8 8h10M8 12h7M8 16h10" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    mode: 'centerH',
    title: 'Align center (horizontal)',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 4v16M7 8h10M8 12h8M7 16h10" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    mode: 'right',
    title: 'Align right',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M20 4v16M6 8h10M9 12h7M6 16h10" strokeLinecap="round" />
      </svg>
    ),
  },
]

const alignVertical: Array<{ mode: AlignMode; title: string; icon: ReactNode }> = [
  {
    mode: 'top',
    title: 'Align top',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 4h16M8 8v10M12 8v7M16 8v10" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    mode: 'centerV',
    title: 'Align middle (vertical)',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 12h16M8 7v10M12 8v8M16 7v10" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    mode: 'bottom',
    title: 'Align bottom',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 20h16M8 6v10M12 9v7M16 6v10" strokeLinecap="round" />
      </svg>
    ),
  },
]

type AlignMenu = 'h' | 'v' | null

export function Toolbar() {
  const tool = useCanvasStore((s) => s.tool)
  const setTool = useCanvasStore((s) => s.setTool)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const selectedStackIds = useCanvasStore((s) => s.selectedStackIds)
  const zoom = useCanvasStore((s) => s.viewport.zoom)
  const cHeld = useCanvasStore((s) => s.cHeld)
  const quickStack = useCanvasStore((s) => s.quickStack)
  const smoothLayout = useCanvasStore((s) => s.smoothLayout)
  const rowLayout = useCanvasStore((s) => s.rowLayout)
  const snapEnabled = useCanvasStore((s) => s.snapEnabled)
  const toggleSnap = useCanvasStore((s) => s.toggleSnap)
  const immersiveMode = useCanvasStore((s) => s.immersiveMode)
  const toggleImmersiveMode = useCanvasStore((s) => s.toggleImmersiveMode)
  const [alignMenu, setAlignMenu] = useState<AlignMenu>(null)
  const alignGroupRef = useRef<HTMLDivElement>(null)

  const hasMulti = selectedIds.length + selectedStackIds.length >= 2

  useEffect(() => {
    if (!hasMulti) setAlignMenu(null)
  }, [hasMulti])

  useEffect(() => {
    if (!alignMenu) return
    const onDoc = (e: PointerEvent) => {
      if (!alignGroupRef.current?.contains(e.target as Node)) {
        setAlignMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAlignMenu(null)
    }
    document.addEventListener('pointerdown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDoc, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [alignMenu])

  const runAlign = (mode: AlignMode) => {
    useCanvasStore.getState().alignSelected(mode)
    setAlignMenu(null)
  }

  return (
    <>
      <div className="window-drag-strip" />

      <aside className="dock dock-left">
        <div className="tool-group vertical">
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tool-btn ${tool === t.id ? 'active' : ''}`}
              title={`${t.label} (${t.hint})`}
              aria-label={`${t.label} tool (${t.hint})`}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
            >
              <Icon name={t.icon} />
            </button>
          ))}
        </div>
      </aside>

      <StyleInspector />

      <aside className="dock dock-right">
        {cHeld && <span className="mode-pill crop">Crop</span>}
        <span className="zoom-pill">{Math.round(zoom * 100)}%</span>

        <div className="tool-group vertical">
          <button
            type="button"
            className={`tool-btn ${snapEnabled ? 'active' : ''}`}
            onClick={toggleSnap}
            aria-label={snapEnabled ? 'Disable snapping' : 'Enable snapping'}
            aria-pressed={snapEnabled}
            title={snapEnabled ? 'Snap on — click to disable' : 'Snap off — click to enable'}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 12h6M14 12h6M12 4v6M12 14v6" strokeLinecap="round" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          </button>
          <button
            type="button"
            className="tool-btn"
            disabled={!hasMulti}
            onClick={quickStack}
            aria-label="Stack selection"
            title="Stack (Ctrl+G)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="5" y="5" width="10" height="10" rx="1.5" opacity="0.45" />
              <rect x="8" y="8" width="10" height="10" rx="1.5" opacity="0.7" />
              <rect x="11" y="11" width="10" height="10" rx="1.5" />
            </svg>
          </button>
          <button
            type="button"
            className="tool-btn"
            disabled={!hasMulti}
            onClick={() => smoothLayout()}
            aria-label="Unstack and arrange selection"
            title="Unstack / Layout (Alt+G)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="4" width="7" height="7" rx="1.5" />
              <rect x="14" y="4" width="7" height="7" rx="1.5" />
              <rect x="3" y="13" width="7" height="7" rx="1.5" />
              <rect x="14" y="13" width="7" height="7" rx="1.5" />
            </svg>
          </button>
          <button
            type="button"
            className="tool-btn"
            disabled={!hasMulti}
            onClick={rowLayout}
            aria-label="Arrange selection in a row"
            title="Row layout"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="8" width="5" height="8" rx="1" />
              <rect x="10" y="8" width="5" height="8" rx="1" />
              <rect x="17" y="8" width="4" height="8" rx="1" />
            </svg>
          </button>
        </div>

        {/* Align — two parents (H / V); expand for secondary modes */}
        {hasMulti && (
          <div
            ref={alignGroupRef}
            className="tool-group vertical align-group"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="align-menu-row">
              <button
                type="button"
                className={`tool-btn ${alignMenu === 'h' ? 'active' : ''}`}
                aria-label="Horizontal align"
                aria-expanded={alignMenu === 'h'}
                title="Horizontal align"
                onClick={(e) => {
                  e.stopPropagation()
                  setAlignMenu((m) => (m === 'h' ? null : 'h'))
                }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 4v16M8 8h12M8 12h9M8 16h12" strokeLinecap="round" />
                </svg>
              </button>
              {alignMenu === 'h' && (
                <div className="align-submenu" role="menu" aria-label="Horizontal align options">
                  {alignHorizontal.map((b) => (
                    <button
                      key={b.mode}
                      type="button"
                      className="tool-btn"
                      role="menuitem"
                      aria-label={b.title}
                      title={b.title}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        runAlign(b.mode)
                      }}
                    >
                      {b.icon}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="align-menu-row">
              <button
                type="button"
                className={`tool-btn ${alignMenu === 'v' ? 'active' : ''}`}
                aria-label="Vertical align"
                aria-expanded={alignMenu === 'v'}
                title="Vertical align"
                onClick={(e) => {
                  e.stopPropagation()
                  setAlignMenu((m) => (m === 'v' ? null : 'v'))
                }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 4h16M8 8v12M12 8v9M16 8v12" strokeLinecap="round" />
                </svg>
              </button>
              {alignMenu === 'v' && (
                <div className="align-submenu" role="menu" aria-label="Vertical align options">
                  {alignVertical.map((b) => (
                    <button
                      key={b.mode}
                      type="button"
                      className="tool-btn"
                      role="menuitem"
                      aria-label={b.title}
                      title={b.title}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        runAlign(b.mode)
                      }}
                    >
                      {b.icon}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Bottom-right immersive toggle (hover corner to reveal) */}
      <div className="immersive-hotzone">
        <button
          type="button"
          className={`immersive-toggle ${immersiveMode ? 'is-active' : ''}`}
          title={
            immersiveMode
              ? 'Exit immersive mode (Ctrl+F)'
              : 'Immersive mode (Ctrl+F)'
          }
          aria-pressed={immersiveMode}
          aria-label={immersiveMode ? 'Exit immersive mode' : 'Enter immersive mode'}
          onClick={() => toggleImmersiveMode()}
        >
          {immersiveMode ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 3H5a2 2 0 00-2 2v4M15 3h4a2 2 0 012 2v4M9 21H5a2 2 0 01-2-2v-4M15 21h4a2 2 0 002-2v-4" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
    </>
  )
}
