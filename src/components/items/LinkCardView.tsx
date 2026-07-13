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
  proxiedImageUrl,
  proxyImageToDataUrl,
} from '../../utils/linkMeta'
import { openExternal, isDesktop } from '../../utils/desktop'

interface Props {
  item: LinkCardItem
  selected: boolean
}

type MenuState = { x: number; y: number } | null

/** One automatic re-fetch when a card finished without a thumb (X/YT recovery). */
const missingImageRetried = new Set<string>()

function isPreviewSpecialHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return (
      h === 'x.com' ||
      h.endsWith('.x.com') ||
      h === 'twitter.com' ||
      h.endsWith('.twitter.com') ||
      h === 'youtu.be' ||
      h === 'youtube.com' ||
      h.endsWith('.youtube.com')
    )
  } catch {
    return false
  }
}

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

    const placeholder = placeholderPreview(url)
    // Avoid re-fetching a bookmark every time a saved board is reopened.
    // Older saved files do not have previewStatus, so detect their resolved
    // metadata by comparing it to the initial local placeholder.
    const hasStoredPreview =
      item.previewStatus === 'complete' ||
      (!item.previewStatus &&
        (Boolean(item.image) ||
          Boolean(item.siteName) ||
          item.title !== placeholder.title ||
          item.description !== placeholder.description))

    // Cards that resolved before Article/media parsing: one retry so X Article
    // covers (and empty thumbs) can recover without infinite re-fetch loops.
    const img = item.image || ''
    const hasRealXMedia =
      /twimg\.com\/media|twimg\.com%2Fmedia|pbs\.twimg\.com\/media/i.test(img) ||
      /ytimg\.com|img\.youtube\.com/i.test(img) ||
      img.startsWith('data:image/')
    const imageLooksWeak =
      !img ||
      /profile_images|profile_banners/.test(img) ||
      (isPreviewSpecialHost(url) && !hasRealXMedia)
    const canRetryMissingImage =
      item.previewStatus === 'complete' &&
      imageLooksWeak &&
      isPreviewSpecialHost(url) &&
      !missingImageRetried.has(item.id)

    if (hasStoredPreview && !canRetryMissingImage) {
      setLoading(false)
      return
    }
    if (canRetryMissingImage) {
      missingImageRetried.add(item.id)
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

      // Keep the icon shown immediately after paste. Remote metadata often
      // supplies a different favicon URL which may fail inside WebView2 (X is
      // a common example), causing a visible icon swap followed by a blank
      // tile. Metadata refreshes title/description/image, never an icon that
      // is already present on the card.
      const stableFavicon = current.favicon || merged.favicon

      const same =
        current.title === merged.title &&
        current.description === merged.description &&
        (current.favicon || '') === (stableFavicon || '') &&
        (current.image || '') === (merged.image || '') &&
        (current.siteName || '') === (merged.siteName || '')

      if (!same || current.previewStatus !== 'complete') {
        updateItem(item.id, {
          title: merged.title,
          description: merged.description,
          favicon: stableFavicon,
          image: merged.image,
          siteName: merged.siteName,
          previewStatus: 'complete',
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
      previewStatus: url ? 'pending' : undefined,
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
                  referrerPolicy="no-referrer"
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
              // YT / X CDNs often block hotlinks that send a page Referer
              referrerPolicy="no-referrer"
              onError={() => {
                const src = item.image
                if (!src || src.startsWith('data:')) {
                  setImgBroken(true)
                  return
                }

                if (!/^https?:\/\//i.test(src)) {
                  setImgBroken(true)
                  return
                }

                // Desktop: native download → data URL, then public proxy
                if (isDesktop()) {
                  void proxyImageToDataUrl(src, '')
                    .then((data) => {
                      if (data?.startsWith('data:')) return data
                      return proxyImageToDataUrl(src, item.url)
                    })
                    .then((data) => {
                      if (data?.startsWith('data:')) {
                        updateItem(item.id, { image: data })
                        setImgBroken(false)
                        return
                      }
                      const proxied = proxiedImageUrl(src)
                      if (proxied !== src) {
                        updateItem(item.id, { image: proxied })
                        setImgBroken(false)
                        return
                      }
                      setImgBroken(true)
                    })
                  return
                }

                // Browser: re-route blocked CDNs through wsrv.nl once
                const proxied = proxiedImageUrl(src)
                if (proxied !== src) {
                  updateItem(item.id, { image: proxied })
                  setImgBroken(false)
                  return
                }
                setImgBroken(true)
              }}
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
