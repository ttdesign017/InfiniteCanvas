import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { stackDisplayName, stackPath } from '../utils/stacks'

/**
 * Top-left breadcrumb while inside a stack.
 * Fades in/out; double-click a stack segment to rename (same as folder tab).
 */
export function CanvasPath() {
  const currentContainerId = useCanvasStore((s) => s.currentContainerId)
  const stackEnterAnim = useCanvasStore((s) => s.stackEnterAnim)
  const stacks = useCanvasStore((s) => s.stacks)
  const navigateToContainer = useCanvasStore((s) => s.navigateToContainer)
  const commitStackName = useCanvasStore((s) => s.commitStackName)
  const setEditingStackGroupId = useCanvasStore((s) => s.setEditingStackGroupId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // During exit, path tracks the destination immediately (with the morph),
  // not the late canvas handoff of currentContainerId.
  const pathContainerId =
    stackEnterAnim?.mode === 'exit' && stackEnterAnim.targetContainerId
      ? stackEnterAnim.targetContainerId
      : currentContainerId

  const inside = pathContainerId !== ROOT_CONTAINER_ID
  const [mounted, setMounted] = useState(inside)
  const [visible, setVisible] = useState(inside)

  // Fade mount/unmount
  useEffect(() => {
    if (inside) {
      setMounted(true)
      const id = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(id)
    }
    setVisible(false)
    const t = window.setTimeout(() => setMounted(false), 240)
    return () => window.clearTimeout(t)
  }, [inside])

  const crumbs = useMemo(() => {
    const path = stackPath(stacks, pathContainerId)
    return [
      { id: ROOT_CONTAINER_ID, name: 'Home' },
      ...path.map((st) => ({
        id: st.id,
        name: stackDisplayName(st, 'Untitled'),
      })),
    ]
  }, [stacks, pathContainerId])

  useEffect(() => {
    if (!editingId) return
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 20)
    return () => window.clearTimeout(t)
  }, [editingId])

  useEffect(() => {
    if (editingId && editingId !== pathContainerId) {
      setEditingId(null)
    }
  }, [pathContainerId, editingId])

  if (!mounted) return null

  const startRename = (stackId: string) => {
    if (stackId === ROOT_CONTAINER_ID) return
    const st = stacks.find((s) => s.id === stackId)
    setDraft((st?.name || '').trim())
    setEditingId(stackId)
    setEditingStackGroupId(stackId)
  }

  const commit = () => {
    if (!editingId) return
    commitStackName(editingId, draft)
    setEditingId(null)
  }

  const cancel = () => {
    setEditingId(null)
    setEditingStackGroupId(null)
  }

  return (
    <nav
      className={`canvas-path ${visible ? 'is-visible' : ''}`}
      aria-label="Canvas path"
    >
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1
        const isEditing = editingId === c.id
        return (
          <span key={c.id} style={{ display: 'contents' }}>
            {i > 0 && (
              <span className="canvas-path-sep" aria-hidden>
                /
              </span>
            )}
            {isEditing ? (
              <input
                ref={inputRef}
                className="canvas-path-input"
                value={draft}
                placeholder="Untitled"
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commit()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancel()
                  }
                }}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : (
              <button
                type="button"
                className={`canvas-path-seg ${isLast ? 'is-current' : ''}`}
                title={isLast ? 'Double-click to rename' : c.name}
                onClick={() => {
                  if (!isLast) navigateToContainer(c.id)
                }}
                onDoubleClick={(e) => {
                  if (c.id === ROOT_CONTAINER_ID) return
                  e.preventDefault()
                  e.stopPropagation()
                  startRename(c.id)
                }}
              >
                {c.name}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
