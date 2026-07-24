import { useEffect, useRef } from 'react'
import type { TextItem } from '../../types/canvas'
import { useCanvasStore } from '../../store/useCanvasStore'
import { useHistoryOnce } from '../../hooks/useHistoryOnce'
import { useAutoFocusEdit } from '../../hooks/useAutoFocusEdit'

const PLACEHOLDERS = new Set(['Text', 'Double-click to edit'])

interface Props {
  item: TextItem
  selected: boolean
}

export function TextItemView({ item, selected }: Props) {
  const updateItem = useCanvasStore((s) => s.updateItem)
  const editingId = useCanvasStore((s) => s.editingId)
  const setEditingId = useCanvasStore((s) => s.setEditingId)
  const editing = editingId === item.id
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const isEmpty = !item.content.trim()
  const isLegacyPlaceholder = PLACEHOLDERS.has(item.content.trim())
  // One undo snapshot for the whole edit session (placeholder clear + typing)
  const pushHistoryOnce = useHistoryOnce(editing ? item.id : null)

  // Clear legacy placeholder text when entering edit
  useEffect(() => {
    if (!editing) return
    if (!item.content.trim() || !PLACEHOLDERS.has(item.content.trim())) return
    pushHistoryOnce()
    updateItem(item.id, { content: '' })
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const { onBlur } = useAutoFocusEdit(editing, areaRef, () => setEditingId(null))

  const hasBg =
    item.backgroundColor &&
    item.backgroundColor !== 'transparent' &&
    item.backgroundColor !== 'rgba(0,0,0,0)'

  const showPlaceholder = !editing && (isEmpty || isLegacyPlaceholder)

  return (
    <div
      className={`plain-text ${selected ? 'is-selected' : ''} ${editing ? 'is-editing' : ''} ${hasBg ? 'has-bg' : ''}`}
      style={{
        // Always drive color from item — placeholder only reduces opacity
        color: item.color || '#1e1e1e',
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        fontWeight: item.fontWeight,
        background: item.backgroundColor,
      }}
    >
      {editing ? (
        <textarea
          ref={areaRef}
          className="plain-text-input"
          autoFocus
          value={PLACEHOLDERS.has(item.content.trim()) ? '' : item.content}
          style={{ color: item.color || '#1e1e1e' }}
          onChange={(e) => {
            pushHistoryOnce()
            updateItem(item.id, { content: e.target.value })
          }}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditingId(null)
              ;(e.target as HTMLTextAreaElement).blur()
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
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
          className={`plain-text-body ${showPlaceholder ? 'is-placeholder' : ''}`}
          style={{ color: item.color || '#1e1e1e' }}
        >
          {showPlaceholder ? 'Text' : item.content}
        </div>
      )}
    </div>
  )
}
