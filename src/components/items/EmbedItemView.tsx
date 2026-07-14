import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EmbedItem } from '../../types/canvas'
import { useCanvasStore } from '../../store/useCanvasStore'
import {
  attachEmbedIframe,
  setEmbedIframePointerEvents,
} from '../../utils/embedIframeCache'

interface Props {
  item: EmbedItem
  selected: boolean
  /**
   * Fan preview on a parent canvas — stack is one atomic unit.
   * No hover, drag chrome, or iframe clicks (hits pass through to folder).
   */
  stackPreview?: boolean
}

/**
 * Free on a canvas: hover/selected → iframe live; top bar → drag.
 * Stack fan preview: fully inert (stack unit only; interact after enter).
 */
function EmbedItemViewInner({
  item,
  selected,
  stackPreview = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const select = useCanvasStore((s) => s.select)

  // Never interactive as a fan card — only after entering the stack
  const interactive = !stackPreview && (selected || hovered)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    attachEmbedIframe(host, item.id, item.src, item.title)
    setEmbedIframePointerEvents(item.id, interactive)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.src, item.title])

  useEffect(() => {
    // Force none for previews even if style was left 'auto' from a prior free pose
    setEmbedIframePointerEvents(item.id, interactive)
  }, [item.id, interactive])

  const pointInRoot = useCallback((clientX: number, clientY: number) => {
    const el = rootRef.current
    if (!el) return false
    const r = el.getBoundingClientRect()
    return (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    )
  }, [])

  useEffect(() => {
    if (stackPreview || !hovered || selected) return
    const onMove = (e: PointerEvent) => {
      if (!pointInRoot(e.clientX, e.clientY)) setHovered(false)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [hovered, selected, stackPreview, pointInRoot])

  // Clear hover when becoming a preview (exit stack / nest)
  useEffect(() => {
    if (stackPreview) setHovered(false)
  }, [stackPreview])

  return (
    <div
      ref={rootRef}
      className={`embed-item ${selected ? 'is-selected' : ''} ${
        interactive ? 'is-live' : ''
      } ${stackPreview ? 'is-stack-preview' : ''}`}
      onPointerEnter={() => {
        if (!stackPreview) setHovered(true)
      }}
      onPointerLeave={(e) => {
        if (stackPreview) return
        if (pointInRoot(e.clientX, e.clientY)) return
        setHovered(false)
      }}
    >
      {/* Drag chrome only when free — previews are not individually draggable */}
      {!stackPreview && (
        <div
          className="embed-drag-bar"
          data-embed-drag
          title="Drag"
          aria-label="Drag embed"
        >
          <span className="embed-drag-grip" aria-hidden />
        </div>
      )}

      <div
        className="embed-frame"
        ref={hostRef}
        onPointerDown={(e) => {
          if (stackPreview) return
          if ((e.target as HTMLElement).closest?.('[data-embed-drag]')) return
          if (!interactive) return
          e.stopPropagation()
          if (!selected) select([item.id])
        }}
        onWheel={(e) => {
          if (interactive) e.stopPropagation()
        }}
      />

      {/* Full inert cover as fan card — events fall through to stack folder */}
      {(stackPreview || !interactive) && (
        <div
          className={`embed-hit-shield ${stackPreview ? 'is-passthrough' : ''}`}
          aria-hidden
        />
      )}
    </div>
  )
}

export const EmbedItemView = memo(
  EmbedItemViewInner,
  (prev, next) =>
    prev.selected === next.selected &&
    prev.stackPreview === next.stackPreview &&
    prev.item.id === next.item.id &&
    prev.item.src === next.item.src &&
    prev.item.title === next.item.title,
)
