import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  open: boolean
  value: number
  min: number
  max: number
  unit?: string
  /** Anchor button element */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Prefer side of anchor: right (docks) or bottom (top style bar) */
  placement?: 'right' | 'bottom'
  onChange: (value: number) => void
  onClose: () => void
}

/**
 * Floating size slider — value on the left, track on the right.
 * Supports continuous pointer drag (native range + local draft state).
 */
export function SizePopover({
  open,
  value,
  min,
  max,
  unit = 'px',
  anchorRef,
  placement = 'right',
  onChange,
  onClose,
}: Props) {
  const popRef = useRef<HTMLDivElement>(null)
  const rangeRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  // Local draft so drag stays smooth even if parent re-renders slowly
  const [draft, setDraft] = useState(value)
  const dragging = useRef(false)

  useEffect(() => {
    if (!dragging.current) setDraft(value)
  }, [value])

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    if (placement === 'bottom') {
      setPos({
        left: Math.round(r.left + r.width / 2),
        top: Math.round(r.bottom + 8),
      })
    } else {
      setPos({
        left: Math.round(r.right + 10),
        top: Math.round(r.top + r.height / 2),
      })
    }
  }, [open, anchorRef, placement])

  // Close on outside click — ignore while pointer is down on the slider
  useEffect(() => {
    if (!open) return

    const onDocPointerDown = (e: PointerEvent) => {
      if (dragging.current) return
      const t = e.target as Node
      if (popRef.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      onClose()
    }

    // pointerdown capture so we don't fight canvas handlers after release
    document.addEventListener('pointerdown', onDocPointerDown, true)
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true)
  }, [open, onClose, anchorRef])

  // Focus range when opened for keyboard + immediate drag
  useEffect(() => {
    if (!open) return
    setDraft(value)
    // Defer so portal is mounted
    requestAnimationFrame(() => rangeRef.current?.focus({ preventScroll: true }))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const commit = (raw: number) => {
    const next = Math.min(max, Math.max(min, Math.round(raw)))
    setDraft(next)
    onChange(next)
  }

  return createPortal(
    <div
      ref={popRef}
      className={`size-popover-fixed ${placement === 'bottom' ? 'placement-bottom' : ''}`}
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => {
        // Keep canvas / window-drag from stealing the interaction
        e.stopPropagation()
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="size-popover-value">
        {draft}
        {unit}
      </span>
      <input
        ref={rangeRef}
        type="range"
        className="theme-range"
        min={min}
        max={max}
        step={1}
        value={draft}
        onPointerDown={(e) => {
          dragging.current = true
          e.stopPropagation()
          // Ensure continuous updates even if capture is contested
          ;(e.currentTarget as HTMLInputElement).setPointerCapture?.(e.pointerId)
        }}
        onPointerUp={(e) => {
          dragging.current = false
          try {
            ;(e.currentTarget as HTMLInputElement).releasePointerCapture?.(e.pointerId)
          } catch {
            /* ignore */
          }
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
        onChange={(e) => commit(Number(e.target.value))}
        onInput={(e) => commit(Number((e.target as HTMLInputElement).value))}
      />
    </div>,
    document.body,
  )
}
