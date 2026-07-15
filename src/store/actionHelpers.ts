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

export function measureNoteCardHeight(
  content: string,
  width: number,
  fontSize: number,
): number {
  // Matches .notion-card: padding 12+18, gap 8, label ~18, body line-height 1.5
  const padX = 28
  const padTop = 12
  const padBottom = 18
  const gap = 8
  const labelH = 18
  const minH = 80
  const maxH = 900
  const bodyWidth = Math.max(40, width - padX)
  if (typeof document === 'undefined') {
    const lines = content.split(/\r?\n/)
    let count = 0
    const maxChars = Math.max(8, Math.floor(bodyWidth / (fontSize * 0.55)))
    for (const line of lines) {
      count += Math.max(1, Math.ceil(Math.max(1, line.length) / maxChars))
    }
    return Math.max(
      minH,
      Math.min(
        maxH,
        padTop + padBottom + gap + labelH + count * fontSize * 1.5 + 4,
      ),
    )
  }
  const el = document.createElement('div')
  el.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    'visibility:hidden',
    `width:${bodyWidth}px`,
    `font-size:${fontSize}px`,
    'line-height:1.5',
    'white-space:pre-wrap',
    'word-break:break-word',
    'overflow-wrap:anywhere',
    'font-family:var(--font-ui),system-ui,sans-serif',
  ].join(';')
  el.textContent = content
  document.body.appendChild(el)
  const bodyH = el.scrollHeight
  el.remove()
  return Math.max(
    minH,
    Math.min(maxH, padTop + padBottom + gap + labelH + bodyH + 6),
  )
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
