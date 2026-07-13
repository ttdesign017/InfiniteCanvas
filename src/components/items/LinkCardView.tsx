import { useState } from 'react'
import type { LinkCardItem } from '../../types/canvas'
import { useCanvasStore } from '../../store/useCanvasStore'
import {
  extractDomain,
  faviconFor,
  guessTitleFromUrl,
  normalizeUrl,
} from '../../utils/linkMeta'
import { openExternal } from '../../utils/desktop'

interface Props {
  item: LinkCardItem
  selected: boolean
}

export function LinkCardView({ item, selected }: Props) {
  const updateItem = useCanvasStore((s) => s.updateItem)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.url)

  const openLink = async () => {
    if (!item.url) {
      setEditing(true)
      return
    }
    await openExternal(item.url)
  }

  const commit = () => {
    const url = normalizeUrl(draft)
    updateItem(item.id, {
      url,
      title: url ? guessTitleFromUrl(url) : 'Untitled link',
      description: url ? extractDomain(url) : 'Add a URL',
      favicon: url ? faviconFor(url) : undefined,
    })
    setEditing(false)
  }

  return (
    <div className={`notion-card link-card ${selected ? 'is-selected' : ''}`}>
      <div className="notion-card-label">
        <span className="notion-card-icon" aria-hidden>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6.5 9.5a3 3 0 004.2 0l1.2-1.2a3 3 0 00-4.2-4.2L7 4.8" strokeLinecap="round" />
            <path d="M9.5 6.5a3 3 0 00-4.2 0L4.1 7.7a3 3 0 004.2 4.2L9 11.2" strokeLinecap="round" />
          </svg>
        </span>
        Link
      </div>

      <div className="link-card-main">
        <div className="link-favicon">
          {item.favicon ? (
            <img src={item.favicon} alt="" draggable={false} />
          ) : (
            <span className="link-favicon-fallback">↗</span>
          )}
        </div>
        <div className="link-meta">
          <div className="link-title">{item.title}</div>
          <div className="link-desc">{item.description}</div>
        </div>
      </div>

      {editing ? (
        <div className="link-edit" onPointerDown={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={draft}
            placeholder="https://…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={commit}
          />
        </div>
      ) : (
        <div className="notion-card-actions">
          <button
            type="button"
            className="notion-card-btn primary"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              void openLink()
            }}
          >
            Open
          </button>
          <button
            type="button"
            className="notion-card-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setDraft(item.url)
              setEditing(true)
            }}
          >
            Edit
          </button>
        </div>
      )}
    </div>
  )
}
