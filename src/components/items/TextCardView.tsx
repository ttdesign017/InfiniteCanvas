import { useEffect, useRef } from 'react'
import type { TextCardItem } from '../../types/canvas'
import { useCanvasStore } from '../../store/useCanvasStore'
import { useHistoryOnce } from '../../hooks/useHistoryOnce'

const PLACEHOLDERS = new Set(['Write a note…', 'Write a note...', 'New note', 'Double-click to edit'])

interface Props {
  item: TextCardItem
  selected: boolean
}

export function TextCardView({ item, selected }: Props) {
  const updateItem = useCanvasStore((s) => s.updateItem)
  const editingId = useCanvasStore((s) => s.editingId)
  const setEditingId = useCanvasStore((s) => s.setEditingId)
  const editing = editingId === item.id
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const isEmpty = !item.content.trim()
  const isLegacyPlaceholder = PLACEHOLDERS.has(item.content.trim())
  // One undo snapshot for the whole edit session (placeholder clear + typing)
  const pushHistoryOnce = useHistoryOnce(editing ? item.id : null)

  useEffect(() => {
    if (!editing) return
    const el = areaRef.current
    if (!el) return
    if (!item.content.trim() || PLACEHOLDERS.has(item.content.trim())) {
      if (item.content) {
        pushHistoryOnce()
        updateItem(item.id, { content: '' })
      }
    }
    el.focus()
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const showPlaceholder = !editing && (isEmpty || isLegacyPlaceholder)
  const labelColor = item.labelColor || '#8c8c8c'
  const labelBg =
    item.labelBackground && item.labelBackground !== 'transparent'
      ? item.labelBackground
      : 'transparent'

  return (
    <div
      className={`notion-card text-card ${selected ? 'is-selected' : ''} ${editing ? 'is-editing' : ''}`}
      style={{
        background: item.backgroundColor,
        color: item.color,
        fontSize: item.fontSize,
      }}
    >
      <div
        className="notion-card-label"
        style={{
          color: labelColor,
          background: labelBg,
          borderRadius: labelBg !== 'transparent' ? 6 : undefined,
          padding: labelBg !== 'transparent' ? '2px 8px' : undefined,
          alignSelf: 'flex-start',
        }}
      >
        <span className="notion-card-icon" aria-hidden style={{ color: labelColor }}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3.5h10M3 8h10M3 12.5h6" strokeLinecap="round" />
          </svg>
        </span>
        Note
      </div>
      {editing ? (
        <textarea
          ref={areaRef}
          className="notion-card-input"
          value={PLACEHOLDERS.has(item.content.trim()) ? '' : item.content}
          style={{ color: item.color }}
          placeholder=""
          onChange={(e) => {
            pushHistoryOnce()
            updateItem(item.id, { content: e.target.value })
          }}
          onBlur={() => setEditingId(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditingId(null)
              ;(e.target as HTMLTextAreaElement).blur()
            }
            e.stopPropagation()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className={`notion-card-body ${showPlaceholder ? 'is-placeholder' : ''}`}
          style={{ color: showPlaceholder ? undefined : item.color }}
        >
          {showPlaceholder ? 'Write a note…' : item.content}
        </div>
      )}
    </div>
  )
}
