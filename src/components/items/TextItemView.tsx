import { useEffect, useRef } from 'react'
import type { TextItem } from '../../types/canvas'
import { useCanvasStore } from '../../store/useCanvasStore'

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

  useEffect(() => {
    if (!editing) return
    const el = areaRef.current
    if (!el) return
    if (!item.content.trim() || PLACEHOLDERS.has(item.content.trim())) {
      if (item.content) updateItem(item.id, { content: '' })
    }
    el.focus()
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

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
          value={PLACEHOLDERS.has(item.content.trim()) ? '' : item.content}
          style={{ color: item.color || '#1e1e1e' }}
          onChange={(e) => updateItem(item.id, { content: e.target.value })}
          onBlur={() => setEditingId(null)}
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
