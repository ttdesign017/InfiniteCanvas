import type { CanvasItem, StackRecord, TextCardItem } from '../types/canvas'
import type { HistoryEntry } from './types'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { cloneItemsForHistory, cloneStacksForHistory } from './cloneDocument'
import { collectBlobUrlsFromItems } from '../utils/blobUrls'

export function cloneItems(items: CanvasItem[]): CanvasItem[] {
  return cloneItemsForHistory(items)
}

export function cloneStacks(stacks: StackRecord[]): StackRecord[] {
  return cloneStacksForHistory(stacks)
}

export function itemZChanged(
  items: CanvasItem[],
  zMap: Map<string, number>,
): boolean {
  if (zMap.size === 0) return false
  for (const [id, z] of zMap) {
    const it = items.find((i) => i.id === id)
    if (it && it.zIndex !== z) return true
  }
  return false
}

export function stackZChanged(
  stacks: StackRecord[],
  zMap: Map<string, number>,
): boolean {
  if (zMap.size === 0) return false
  for (const [id, z] of zMap) {
    const st = stacks.find((s) => s.id === id)
    if (st && st.zIndex !== z) return true
  }
  return false
}

export function blobUrlsStillReachable(
  liveItems: CanvasItem[],
  history: HistoryEntry[],
  future: HistoryEntry[],
): Set<string> {
  const set = collectBlobUrlsFromItems(liveItems)
  for (const h of history) {
    for (const u of collectBlobUrlsFromItems(h.items)) set.add(u)
  }
  for (const f of future) {
    for (const u of collectBlobUrlsFromItems(f.items)) set.add(u)
  }
  return set
}

export function tagContainer<T extends CanvasItem>(
  item: T,
  containerId: string,
): T {
  if (containerId === ROOT_CONTAINER_ID) {
    if (!item.containerId || item.containerId === ROOT_CONTAINER_ID) return item
    const { containerId: _c, ...rest } = item
    return rest as T
  }
  return { ...item, containerId }
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** Matches link bookmark default width (see addLinkCard). */
export const LINK_CARD_DEFAULT_WIDTH = 476
/** Compact note when empty / short paste. */
export const NOTE_CARD_DEFAULT_WIDTH = 240
export const NOTE_CARD_DEFAULT_HEIGHT = 180
/**
 * Pasted/imported notes at or above this length use the wider link-card
 * width so long articles wrap instead of growing into a tall thin strip.
 */
export const NOTE_LONG_CONTENT_CHARS = 220
/** Soft ceiling only — long articles should still fully fit. */
const NOTE_CARD_MAX_HEIGHT = 50_000

/**
 * Default width for a new note: short → compact; long article → link-card width.
 * Explicit `width` in options always wins.
 */
export function resolveNoteCardWidth(
  content: string,
  explicitWidth?: number,
): number {
  if (explicitWidth != null && Number.isFinite(explicitWidth)) {
    return Math.max(120, explicitWidth)
  }
  const len = content.trim().length
  if (len >= NOTE_LONG_CONTENT_CHARS) return LINK_CARD_DEFAULT_WIDTH
  return NOTE_CARD_DEFAULT_WIDTH
}

/**
 * Measure the canvas height a note card needs for `content`.
 *
 * Matches live DOM: `.notion-card` (border-box, padding 12/14/18, gap 8,
 * 1px border) + label + `.notion-card-body` (line-height 1.5, pad-bottom 2).
 * Previous body-only measure used width − 28 (missed borders) and a fixed
 * chrome sum that was a few px short — last line spilled past the card edge.
 */
export function measureNoteCardHeight(
  content: string,
  width: number,
  fontSize: number,
): number {
  const minH = 80
  const cardW = Math.max(120, width)
  // padding-left/right 14 + border 1 each side
  const bodyWidth = Math.max(40, cardW - 14 * 2 - 1 * 2)
  // Fallback chrome: padTop12 + padBottom18 + borders2 + gap8 + label~18 + bodyPad2
  const chromeFallback = 12 + 18 + 2 + 8 + 18 + 2

  if (typeof document === 'undefined') {
    const lines = content.split(/\r?\n/)
    let count = 0
    const maxChars = Math.max(8, Math.floor(bodyWidth / (fontSize * 0.55)))
    for (const line of lines) {
      count += Math.max(1, Math.ceil(Math.max(1, line.length) / maxChars))
    }
    // Extra line of fudge so fallback never clips the last row
    return Math.max(
      minH,
      Math.min(
        NOTE_CARD_MAX_HEIGHT,
        chromeFallback + (count + 1) * fontSize * 1.5,
      ),
    )
  }

  // Full structural clone so wrap + label + padding match the real card
  const card = document.createElement('div')
  card.className = 'notion-card text-card'
  card.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    `width:${cardW}px`,
    // Class sets height:100% — force content-sized for measurement
    'height:auto',
    `font-size:${fontSize}px`,
    'box-sizing:border-box',
  ].join(';')
  card.style.setProperty('height', 'auto', 'important')

  const label = document.createElement('div')
  label.className = 'notion-card-label'
  const icon = document.createElement('span')
  icon.className = 'notion-card-icon'
  icon.setAttribute('aria-hidden', 'true')
  // Same 12×12 footprint as the live SVG icon
  icon.style.cssText = 'width:12px;height:12px;display:block;flex-shrink:0'
  label.appendChild(icon)
  label.appendChild(document.createTextNode('Note'))

  const body = document.createElement('div')
  body.className = 'notion-card-body'
  // Non-empty so an empty note still measures the placeholder line box
  body.textContent = content.length > 0 ? content : ' '

  card.appendChild(label)
  card.appendChild(body)
  document.body.appendChild(card)

  // Prefer the larger of layout vs scroll metrics (subpixel / fractional lh)
  const rectH = card.getBoundingClientRect().height
  const scrollH = card.scrollHeight
  const bodyScroll = body.scrollHeight
  card.remove()

  // Small buffer for subpixel wrap / font metric drift (not a full extra line)
  const safety = 12
  const measured = Math.ceil(
    Math.max(rectH, scrollH, chromeFallback + bodyScroll),
  )

  return Math.max(
    minH,
    Math.min(NOTE_CARD_MAX_HEIGHT, measured + safety),
  )
}

/**
 * Measure free-floating plain text box (`.plain-text` + body).
 * Width shrinks to content up to `maxWidth`; height follows wrap.
 */
export function measurePlainTextSize(
  content: string,
  opts: {
    fontSize: number
    fontFamily?: string
    fontWeight?: number | string
    maxWidth?: number
    minWidth?: number
    minHeight?: number
  },
): { width: number; height: number } {
  const fontSize = Math.max(8, opts.fontSize)
  const maxWidth = Math.max(48, opts.maxWidth ?? 800)
  const minWidth = Math.max(24, opts.minWidth ?? 48)
  const minHeight = Math.max(20, opts.minHeight ?? 28)
  const fontFamily =
    opts.fontFamily || '"Outfit", system-ui, sans-serif'
  const fontWeight = opts.fontWeight ?? 500
  const text = content.length > 0 ? content : ' '

  if (typeof document === 'undefined') {
    // Rough CJK-aware fallback
    const avg = fontSize * 0.55
    const lines = text.split(/\r?\n/)
    let longest = 1
    let total = 0
    const maxChars = Math.max(4, Math.floor((maxWidth - 12) / avg))
    for (const line of lines) {
      const len = Math.max(1, line.length)
      longest = Math.max(longest, len)
      total += Math.max(1, Math.ceil(len / maxChars))
    }
    const naturalW = Math.ceil(longest * avg + 12)
    const width = Math.min(maxWidth, Math.max(minWidth, naturalW))
    const height = Math.max(
      minHeight,
      Math.ceil(total * fontSize * 1.35 + 8 + 4),
    )
    return { width, height }
  }

  const box = document.createElement('div')
  box.className = 'plain-text'
  box.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    'height:auto',
    'width:max-content',
    `max-width:${maxWidth}px`,
    `font-size:${fontSize}px`,
    `font-family:${fontFamily}`,
    `font-weight:${fontWeight}`,
    'box-sizing:border-box',
  ].join(';')
  box.style.setProperty('height', 'auto', 'important')
  box.style.setProperty('width', 'max-content', 'important')

  const body = document.createElement('div')
  body.className = 'plain-text-body'
  body.textContent = text
  box.appendChild(body)
  document.body.appendChild(box)

  // Content-sized width, clamped
  const rawW = Math.ceil(
    Math.max(box.getBoundingClientRect().width, box.scrollWidth),
  )
  const width = Math.min(maxWidth, Math.max(minWidth, rawW + 2))

  // Re-measure height at the clamped width so wrap matches final box
  box.style.setProperty('width', `${width}px`, 'important')
  box.style.removeProperty('max-width')
  const rawH = Math.ceil(
    Math.max(
      box.getBoundingClientRect().height,
      box.scrollHeight,
      body.scrollHeight + 8,
    ),
  )
  box.remove()

  // Padding 4+4 vertical is in .plain-text; small safety for subpixels
  const height = Math.max(minHeight, rawH + 6)
  return { width, height }
}

export function normalizeImportedItems(items: CanvasItem[]): CanvasItem[] {
  return items.map((raw) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = raw as any
    if (item?.type === 'text' && typeof item.content === 'string' && !item.fontFamily) {
      return {
        id: item.id,
        type: 'textcard',
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation ?? 0,
        zIndex: item.zIndex ?? 1,
        content: item.content,
        fontSize: item.fontSize ?? 14,
        color: item.color ?? '#ebe6dc',
        backgroundColor: item.backgroundColor ?? '#1c1f28',
      } as TextCardItem
    }
    return raw
  })
}

export function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
