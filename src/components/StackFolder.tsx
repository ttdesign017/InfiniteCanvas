import { useEffect, useRef, useState } from 'react'
import type { CanvasItem } from '../types/canvas'
import { useCanvasStore } from '../store/useCanvasStore'

interface Props {
  groupId: string
  members: CanvasItem[]
  bounds: { x: number; y: number; width: number; height: number }
  selected: boolean
  /** Free item is being dragged over this stack as a merge target */
  dropTarget?: boolean
  zIndex: number
  /** Display name (from StackRecord or legacy members) */
  name?: string
  /** External opacity (exit settle crossfade) */
  styleOpacity?: number
  /** Count badge (defaults to members.length) */
  count?: number
  /** z-index for count badge (above fan cards) */
  countZIndex?: number
  onPointerDown: (e: React.PointerEvent) => void
  /** Double-click body/folder → enter stack */
  onEnter?: () => void
}

export function StackFolder({
  groupId,
  members,
  bounds,
  selected,
  dropTarget = false,
  zIndex,
  name = '',
  styleOpacity = 1,
  count,
  countZIndex,
  onPointerDown,
  onEnter,
}: Props) {
  const editingStackGroupId = useCanvasStore((s) => s.editingStackGroupId)
  const setEditingStackGroupId = useCanvasStore((s) => s.setEditingStackGroupId)
  const commitStackName = useCanvasStore((s) => s.commitStackName)

  const stackName =
    name || members.find((m) => m.stackName)?.stackName || ''
  const editing = editingStackGroupId === groupId
  /** Expanded tab only when named or actively typing a name */
  const expanded = editing || stackName.trim().length > 0

  const [draft, setDraft] = useState(stackName)
  const inputRef = useRef<HTMLInputElement>(null)
  const openedAt = useRef(0)

  useEffect(() => {
    if (editing) setDraft(stackName)
  }, [editing, groupId, stackName])

  // Focus once when entering edit — single delayed focus, no retry loop
  useEffect(() => {
    if (!editing) return
    openedAt.current = performance.now()
    const t = window.setTimeout(() => {
      // User may have already started dragging (clears editingStackGroupId)
      if (useCanvasStore.getState().editingStackGroupId !== groupId) return
      const el = inputRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.select()
    }, 50)
    return () => window.clearTimeout(t)
  }, [editing, groupId])

  const commit = () => {
    if (!editing) return
    // Ignore blur within the open click window
    if (performance.now() - openedAt.current < 200) return
    commitStackName(groupId, draft)
  }

  const cancel = () => {
    setDraft(stackName)
    setEditingStackGroupId(null)
  }

  const sizerText = editing ? draft || 'Name' : stackName

  return (
    <div
      className={`stack-folder ${selected ? 'is-selected' : ''} ${
        editing ? 'is-naming' : ''
      } ${expanded ? 'has-name' : 'is-compact'} ${
        dropTarget ? 'is-drop-target' : ''
      }`}
      style={{
        // Grow from folder center when accepting a drop so chrome expands evenly
        transformOrigin: dropTarget ? 'center center' : 'top left',
        transform: dropTarget
          ? `translate(${bounds.x}px, ${bounds.y}px) scale(1.04)`
          : `translate(${bounds.x}px, ${bounds.y}px)`,
        width: bounds.width,
        height: bounds.height,
        zIndex,
        opacity: styleOpacity,
        // Avoid pointer hits while fully transparent during settle
        pointerEvents: styleOpacity < 0.05 ? 'none' : undefined,
      }}
      onPointerDown={(e) => {
        const t = e.target as HTMLElement
        if (t.closest('input.stack-folder-name-input')) {
          e.stopPropagation()
          return
        }
        // Double-click tab only → rename
        if (e.detail >= 2 && t.closest('.stack-folder-tab')) {
          e.stopPropagation()
          e.preventDefault()
          setEditingStackGroupId(groupId)
          return
        }
        // Double-click body / folder → enter nested canvas
        if (e.detail >= 2 && !t.closest('.stack-folder-tab')) {
          e.stopPropagation()
          e.preventDefault()
          onEnter?.()
          return
        }
        onPointerDown(e)
      }}
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement
        if (t.closest('.stack-folder-tab') || t.closest('input')) return
        e.stopPropagation()
        e.preventDefault()
        onEnter?.()
      }}
    >
      <div
        className={`stack-folder-tab ${editing ? 'is-editing' : ''} ${
          expanded ? 'is-expanded' : 'is-compact'
        }`}
        onPointerDown={(e) => {
          // Second press of double-click: rename without starting stack drag
          if (e.detail >= 2) {
            e.stopPropagation()
            e.preventDefault()
            setEditingStackGroupId(groupId)
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setEditingStackGroupId(groupId)
        }}
      >
        {expanded && (
          <span className="stack-folder-tab-sizer" aria-hidden>
            {sizerText || 'Name'}
          </span>
        )}

        {editing ? (
          <input
            ref={inputRef}
            className="stack-folder-name-input"
            value={draft}
            placeholder="Name"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                openedAt.current = 0
                commitStackName(groupId, draft)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
            onBlur={() => commit()}
          />
        ) : expanded ? (
          <span className="stack-folder-tab-label">{stackName}</span>
        ) : null}
      </div>

      <div className="stack-folder-body" />
      {/* Count rendered as sibling layer via portal-like absolute on parent —
          kept here when countZIndex not provided; InfiniteCanvas may pass elevated z. */}
      {countZIndex == null && (
        <span className="stack-folder-label">
          {count ?? members.length}
        </span>
      )}
    </div>
  )
}
