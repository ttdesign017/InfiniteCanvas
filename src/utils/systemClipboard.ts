/**
 * Write canvas selection content to the OS clipboard so Ctrl+V works
 * in external apps (text editors, chat, browsers, etc.).
 *
 * Currently supports:
 * - image / gif → PNG bitmap
 * - text / textcard → plain text
 */

import type { CanvasItem, MediaItem, TextCardItem, TextItem } from '../types/canvas'
import { FULL_CROP, getCrop } from './crop'

const NOTE_PLACEHOLDERS = new Set([
  'Write a note…',
  'Write a note...',
  'New note',
  'Double-click to edit',
])

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // blob: / data: don't need CORS; local asset may still decode without it
    try {
      img.crossOrigin = 'anonymous'
    } catch {
      /* ignore */
    }
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to decode image for clipboard'))
    img.src = src
  })
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    } catch {
      resolve(null)
    }
  })
}

/**
 * Rasterize a media image (full natural resolution, respecting crop) to PNG.
 */
export async function mediaItemToPngBlob(item: MediaItem): Promise<Blob | null> {
  if (item.type !== 'image' && item.type !== 'gif') return null
  if (!item.src) return null

  const crop = getCrop(item)
  const isFull =
    crop.x === FULL_CROP.x &&
    crop.y === FULL_CROP.y &&
    crop.w === FULL_CROP.w &&
    crop.h === FULL_CROP.h

  // Uncropped PNG/JPEG: try direct blob first (preserves original bytes when PNG)
  if (isFull) {
    try {
      const res = await fetch(item.src)
      if (res.ok) {
        const blob = await res.blob()
        if (blob.type === 'image/png' && blob.size > 0) return blob
        // Other formats → re-encode as PNG for broad clipboard support
        if (blob.type.startsWith('image/') && blob.size > 0) {
          const url = URL.createObjectURL(blob)
          try {
            const img = await loadImageElement(url)
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, img.naturalWidth || item.naturalWidth || 1)
            canvas.height = Math.max(1, img.naturalHeight || item.naturalHeight || 1)
            const ctx = canvas.getContext('2d')
            if (!ctx) return null
            ctx.drawImage(img, 0, 0)
            return canvasToPngBlob(canvas)
          } finally {
            URL.revokeObjectURL(url)
          }
        }
      }
    } catch {
      /* fall through to element draw */
    }
  }

  try {
    const img = await loadImageElement(item.src)
    const nw = img.naturalWidth || item.naturalWidth || 1
    const nh = img.naturalHeight || item.naturalHeight || 1
    const sx = Math.round(crop.x * nw)
    const sy = Math.round(crop.y * nh)
    const sw = Math.max(1, Math.round(crop.w * nw))
    const sh = Math.max(1, Math.round(crop.h * nh))
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    return canvasToPngBlob(canvas)
  } catch {
    return null
  }
}

export async function writeTextToSystemClipboard(text: string): Promise<boolean> {
  const value = text.trim()
  if (!value) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* fall through */
  }
  // Legacy fallback
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

export async function writePngBlobToSystemClipboard(blob: Blob): Promise<boolean> {
  if (!blob || blob.size === 0) return false
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      const item = new ClipboardItem({ 'image/png': blob })
      await navigator.clipboard.write([item])
      return true
    }
  } catch {
    return false
  }
  return false
}

export function textContentForClipboard(item: TextItem | TextCardItem): string | null {
  const raw = item.content ?? ''
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (item.type === 'textcard' && NOTE_PLACEHOLDERS.has(trimmed)) return null
  return raw
}

/**
 * Mirror the current free-item selection onto the OS clipboard.
 * Prefers a single image/gif; otherwise joins text from text/textcard items.
 * Returns true when something was written to the system clipboard.
 */
export async function copySelectionToSystemClipboard(
  items: CanvasItem[],
): Promise<boolean> {
  if (items.length === 0) return false

  const images = items.filter(
    (i): i is MediaItem => i.type === 'image' || i.type === 'gif',
  )
  if (images.length === 1 && items.length === 1) {
    const blob = await mediaItemToPngBlob(images[0])
    if (blob) return writePngBlobToSystemClipboard(blob)
    return false
  }

  const texts = items
    .filter((i): i is TextItem | TextCardItem => i.type === 'text' || i.type === 'textcard')
    .map((i) => textContentForClipboard(i))
    .filter((t): t is string => !!t && t.length > 0)

  if (texts.length > 0 && texts.length === items.length) {
    return writeTextToSystemClipboard(texts.join('\n\n'))
  }

  // Mixed multi-select: if exactly one image among selection, still export it
  if (images.length === 1 && texts.length === 0) {
    const blob = await mediaItemToPngBlob(images[0])
    if (blob) return writePngBlobToSystemClipboard(blob)
  }

  // Single text among mixed free selection
  if (texts.length === 1 && images.length === 0 && items.length === 1) {
    return writeTextToSystemClipboard(texts[0])
  }

  return false
}
