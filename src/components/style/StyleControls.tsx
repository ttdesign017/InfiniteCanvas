import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SizePopover } from '../SizePopover'

/** Normalize any css color string to #rrggbb for <input type="color"> */
export function toHexColor(c: string, fallback = '#1e1e1e'): string {
  if (!c || c === 'transparent') return fallback
  if (c.startsWith('#') && (c.length === 7 || c.length === 4)) {
    if (c.length === 4) {
      const r = c[1]
      const g = c[2]
      const b = c[3]
      return `#${r}${r}${g}${g}${b}${b}`
    }
    return c
  }
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (m) {
    const hex = (n: string) => Number(n).toString(16).padStart(2, '0')
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`
  }
  return fallback
}

export function StylePanel({
  title,
  children,
  trailing,
}: {
  title: string
  children: ReactNode
  /** Right-side action (e.g. To Note / To Text) — stays on one row */
  trailing?: ReactNode
}) {
  return (
    <div
      className="style-panel"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="style-panel-title">{title}</span>
      <div className="style-panel-fields">{children}</div>
      {trailing ? <div className="style-panel-trailing">{trailing}</div> : null}
    </div>
  )
}

export function StyleField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="style-field">
      <span className="style-field-label">{label}</span>
      <div className="style-field-control">{children}</div>
    </div>
  )
}

export function ColorField({
  label,
  value,
  fallback = '#1e1e1e',
  onChange,
}: {
  label: string
  value: string
  fallback?: string
  onChange: (hex: string) => void
}) {
  const hex = toHexColor(value, fallback)
  return (
    <StyleField label={label}>
      <label className="style-color" title={label}>
        <span className="style-color-chip" style={{ background: hex }} />
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        />
      </label>
    </StyleField>
  )
}

export function SizeField({
  label,
  value,
  min,
  max,
  unit = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  onChange: (v: number) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Close only when switching field context — NOT on value (that breaks drag)
  useEffect(() => {
    setOpen(false)
  }, [label, min, max])

  return (
    <StyleField label={label}>
      <button
        ref={btnRef}
        type="button"
        className={`style-chip-btn ${open ? 'active' : ''}`}
        title={`${label} — click for slider`}
        onClick={() => setOpen((v) => !v)}
      >
        {value}
        {unit}
      </button>
      <SizePopover
        open={open}
        value={value}
        min={min}
        max={max}
        unit={unit || 'px'}
        placement="bottom"
        anchorRef={btnRef}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </StyleField>
  )
}

export function ChipButton({
  label,
  title,
  active,
  onClick,
  children,
}: {
  label: string
  title?: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <StyleField label={label}>
      <button
        type="button"
        className={`style-chip-btn ${active ? 'active' : ''}`}
        title={title}
        onClick={onClick}
      >
        {children}
      </button>
    </StyleField>
  )
}
