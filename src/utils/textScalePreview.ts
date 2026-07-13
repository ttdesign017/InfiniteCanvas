/**
 * Ephemeral preview while Shift+scaling free text.
 * Uses CSS transform scale (no fontSize reflow) during drag; commit on pointerup.
 */

export type TextScaleOrigin =
  | 'top left'
  | 'top right'
  | 'bottom left'
  | 'bottom right'

export interface TextScalePreview {
  id: string
  /** Uniform scale from orig box */
  scale: number
  origin: TextScaleOrigin
  /** Unscaled layout box (world) */
  baseX: number
  baseY: number
  baseW: number
  baseH: number
  baseFont: number
}

type Listener = () => void

let preview: TextScalePreview | null = null
const listeners = new Set<Listener>()

export function getTextScalePreview(): TextScalePreview | null {
  return preview
}

export function setTextScalePreview(next: TextScalePreview | null): void {
  preview = next
  listeners.forEach((l) => l())
}

export function clearTextScalePreview(): void {
  if (!preview) return
  preview = null
  listeners.forEach((l) => l())
}

export function subscribeTextScalePreview(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function originFromHandle(handle: string): TextScaleOrigin {
  const h = (handle || 'se').toLowerCase()
  if (h === 'nw') return 'bottom right'
  if (h === 'ne') return 'bottom left'
  if (h === 'sw') return 'top right'
  return 'top left' // se and edges default
}

/** World-space top-left of the scaled box for a given scale + origin */
export function scaledBoxFromPreview(p: TextScalePreview): {
  x: number
  y: number
  width: number
  height: number
  fontSize: number
} {
  const s = p.scale
  const w = p.baseW * s
  const h = p.baseH * s
  let x = p.baseX
  let y = p.baseY
  if (p.origin === 'top right') {
    x = p.baseX + p.baseW - w
  } else if (p.origin === 'bottom left') {
    y = p.baseY + p.baseH - h
  } else if (p.origin === 'bottom right') {
    x = p.baseX + p.baseW - w
    y = p.baseY + p.baseH - h
  }
  return {
    x,
    y,
    width: w,
    height: h,
    fontSize: Math.max(8, Math.min(200, p.baseFont * s)),
  }
}
