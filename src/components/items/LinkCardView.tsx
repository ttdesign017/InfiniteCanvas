import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LinkCardItem } from '../../types/canvas'
import { useCanvasStore } from '../../store/useCanvasStore'
import {
  extractDomain,
  fetchLinkPreview,
  mergePreview,
  normalizeUrl,
  placeholderPreview,
} from '../../utils/linkMeta'
import { openExternal } from '../../utils/desktop'

interface Props {
  item: LinkCardItem
  selected: boolean
}

type MenuState = { x: number; y: number } | null

export function LinkCardView({ item, selected }: Props) {
  const updateItem = useCanvasStore((s) => s.updateItem)
  const select = useCanvasStore((s) => s.select)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.url)
  const [loading, setLoading] = useState(false)
  const [imgBroken, setImgBroken] = useState(false)
  const [menu, setMenu] = useState<MenuState>(null)
  const fetchGen = useRef(0)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraft(item.url)
  }, [item.url])

  useEffect(() => {
    setImgBroken(false)
  }, [item.image, item.url])

  // Fetch OG metadata whenever the URL changes
  useEffect(() => {
    const url = item.url?.trim()
    if (!url || !/^https?:\/\//i.test(url)) {
      setLoading(false)
      return
    }

    const gen = ++fetchGen.current
    let cancelled = false
    setLoading(true)

    void (async () => {
      const preview = await fetchLinkPreview(url)
      if (cancelled || gen !== fetchGen.current) return

      const merged = mergePreview(url, preview)
      const current = useCanvasStore.getState().items.find((i) => i.id === item.id)
      if (!current || current.type !== 'link' || current.url !== url) {
        setLoading(false)
        return
      }

      const same =
        current.title === merged.title &&
        current.description === merged.description &&
        (current.favicon || '') === (merged.favicon || '') &&
        (current.image || '') === (merged.image || '') &&
        (current.siteName || '') === (merged.siteName || '')

      if (!same) {
        updateItem(item.id, {
          title: merged.title,
          description: merged.description,
          favicon: merged.favicon,
          image: merged.image,
          siteName: merged.siteName,
        })
      }
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [item.id, item.url, updateItem])

  // Dismiss context menu on outside click / scroll / Escape
  useEffect(() => {
    if (!menu) return

    const close = () => setMenu(null)
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('wheel', close, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('wheel', close, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])

  const openLink = async () => {
    setMenu(null)
    if (!item.url) {
      setEditing(true)
      setDraft(item.url)
      return
    }
    await openExternal(item.url)
  }

  const startEdit = () => {
    setMenu(null)
    select([item.id])
    setDraft(item.url)
    setEditing(true)
  }

  const commit = () => {
    const url = normalizeUrl(draft)
    const place = placeholderPreview(url)
    updateItem(item.id, {
      url,
      title: place.title,
      description: place.description,
      favicon: place.favicon,
      image: undefined,
      siteName: undefined,
    })
    setEditing(false)
  }

  const domain = item.url ? extractDomain(item.url) : ''
  const displayUrl = item.url?.trim() || ''
  const showImage = Boolean(item.image) && !imgBroken
  const subtitle =
    item.description && item.description !== domain && item.description !== item.siteName
      ? item.description
      : item.siteName && item.siteName !== domain
        ? item.siteName
        : ''

  return (
    <div
      className={`notion-card link-card bookmark-card ${selected ? 'is-selected' : ''} ${
        showImage ? 'has-preview' : ''
      } ${loading ? 'is-loading' : ''} ${editing ? 'is-editing' : ''}`}
      data-bookmark-card
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        select([item.id])
        // Keep menu inside viewport
        const pad = 8
        const mw = 148
        const mh = 84
        const x = Math.min(e.clientX, window.innerWidth - mw - pad)
        const y = Math.min(e.clientY, window.innerHeight - mh - pad)
        setMenu({ x: Math.max(pad, x), y: Math.max(pad, y) })
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        void openLink()
      }}
    >
      <div className="bookmark-body">
        <div className="bookmark-text">
          <div className="bookmark-title" title={item.title}>
            {item.title || 'Untitled link'}
          </div>
          {subtitle ? (
            <div className="bookmark-desc" title={subtitle}>
              {subtitle}
            </div>
          ) : loading ? (
            <div className="bookmark-desc bookmark-desc-loading">Fetching preview…</div>
          ) : null}
          <div className="bookmark-footer">
            <span className="bookmark-favicon" aria-hidden>
              {item.favicon ? (
                <img
                  src={item.favicon}
                  alt=""
                  draggable={false}
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <span className="bookmark-favicon-fallback">↗</span>
              )}
            </span>
            <span className="bookmark-url" title={displayUrl || 'No URL'}>
              {displayUrl || 'No URL'}
            </span>
            {loading && <span className="bookmark-spinner" aria-label="Loading" />}
          </div>
        </div>

        {showImage ? (
          <div className="bookmark-thumb">
            <img
              src={item.image}
              alt=""
              draggable={false}
              onError={() => setImgBroken(true)}
            />
          </div>
        ) : loading ? (
          <div className="bookmark-thumb bookmark-thumb-skeleton" aria-hidden />
        ) : (
          <div className="bookmark-thumb bookmark-thumb-empty" aria-hidden>
            <span>↗</span>
          </div>
        )}
      </div>

      {editing && (
        <div
          className="bookmark-edit-overlay"
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <label className="bookmark-edit-label">URL</label>
          <input
            autoFocus
            value={draft}
            placeholder="https://…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(item.url)
                setEditing(false)
              }
            }}
            onBlur={commit}
          />
        </div>
      )}

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="bookmark-context-menu"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <button type="button" role="menuitem" className="bookmark-menu-item" onClick={() => void openLink()}>
              Open
            </button>
            <button type="button" role="menuitem" className="bookmark-menu-item" onClick={startEdit}>
              Edit URL
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
