/**
 * HTML5 drag-and-drop import (browser → canvas).
 * PureRef-style: media files/URLs become media; page URLs become bookmarks; text becomes notes.
 */

import { invoke } from '@tauri-apps/api/core'
import { useCanvasStore } from '../store/useCanvasStore'
import type { CanvasItem } from '../types/canvas'
import { isDesktop } from './desktop'
import { placeItemsTight } from './layout'
import {
  classifyMedia,
  createMediaFromFile,
  createMediaItemFromSrc,
  getExtension,
} from './media'
import { normalizeUrl } from './linkMeta'
import { collectClipboardMedia } from './openMedia'

const MEDIA_EXT_RE =
  /\.(png|jpe?g|webp|gif|bmp|svg|avif|ico|heic|mp4|webm|mov|mkv|avi|ogv|m4v)(\?|#|$)/i

export function looksLikeUrl(text: string): boolean {
  const t = text.trim()
  if (!t || t.includes(' ') || t.length > 2048) return false
  if (/^https?:\/\//i.test(t)) return true
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(t)) return true
  return false
}

export function mediaKindFromUrl(url: string): 'image' | 'gif' | 'video' | null {
  try {
    const path = new URL(url).pathname
    const kind = classifyMedia(path)
    if (kind) return kind
  } catch {
    /* ignore */
  }
  if (MEDIA_EXT_RE.test(url)) {
    const m = url.match(MEDIA_EXT_RE)
    if (m) return classifyMedia(`f.${m[1]}`)
  }
  return null
}

function getDataSafe(dt: DataTransfer, type: string): string {
  try {
    return dt.getData(type) || ''
  } catch {
    return ''
  }
}

/** Parse text/uri-list (RFC 2483) */
function parseUriList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

/** Chrome DownloadURL: mime:filename:url */
function parseDownloadUrls(raw: string): Array<{ mime: string; name: string; url: string }> {
  const out: Array<{ mime: string; name: string; url: string }> = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const first = trimmed.indexOf(':')
    const second = trimmed.indexOf(':', first + 1)
    if (first < 0 || second < 0) continue
    const mime = trimmed.slice(0, first)
    const name = trimmed.slice(first + 1, second)
    const url = trimmed.slice(second + 1)
    if (/^https?:\/\//i.test(url)) {
      out.push({ mime, name, url })
    }
  }
  return out
}

function extractAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i')
  const m = tag.match(re)
  return m?.[1] ?? null
}

/** Pull image/video/src URLs and anchor hrefs from dropped HTML fragments */
function parseHtmlDrop(html: string): {
  mediaUrls: Array<{ url: string; kind: 'image' | 'gif' | 'video'; name?: string }>
  hrefs: string[]
} {
  const mediaUrls: Array<{ url: string; kind: 'image' | 'gif' | 'video'; name?: string }> = []
  const hrefs: string[] = []
  const seen = new Set<string>()

  const addMedia = (url: string | null, fallback: 'image' | 'gif' | 'video') => {
    if (!url) return
    const absolute = absolutize(url)
    if (!absolute || seen.has(absolute)) return
    // Prefer extension/mime from URL; else tag-based fallback
    const kind = mediaKindFromUrl(absolute) || fallback
    seen.add(absolute)
    mediaUrls.push({
      url: absolute,
      kind,
      name: fileNameFromUrl(absolute),
    })
  }

  // <img ...>
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    addMedia(
      extractAttr(tag, 'src') ||
        extractAttr(tag, 'data-src') ||
        extractAttr(tag, 'data-original'),
      'image',
    )
  }

  // <video ...> and <source ...>
  for (const m of html.matchAll(/<(?:video|source)\b[^>]*>/gi)) {
    const tag = m[0]
    const src = extractAttr(tag, 'src')
    if (src) addMedia(src, 'video')
  }

  // <a href>
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = extractAttr(m[0], 'href')
    if (href && looksLikeUrl(href)) {
      const abs = normalizeUrl(href)
      if (abs && !hrefs.includes(abs)) hrefs.push(abs)
    }
  }

  return { mediaUrls, hrefs }
}

function absolutize(url: string): string | null {
  const t = url.trim()
  if (!t || t.startsWith('data:') || t.startsWith('blob:')) return t || null
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('//')) return `https:${t}`
  return null
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (last) return decodeURIComponent(last.split('?')[0])
  } catch {
    /* ignore */
  }
  return 'media'
}

export type DropImportPayload =
  | { type: 'media-files'; files: File[] }
  | {
      type: 'media-urls'
      urls: Array<{ url: string; kind: 'image' | 'gif' | 'video'; name?: string }>
    }
  | { type: 'link'; url: string }
  | { type: 'text'; text: string }
  | { type: 'empty' }

/**
 * Inspect DataTransfer and decide what to place on the canvas.
 * Priority: real media files → media URLs (img/video) → page link → plain text.
 */
export function parseDropDataTransfer(dt: DataTransfer): DropImportPayload {
  // 1) Real files (local FS / some browser image drags)
  const files = collectClipboardMedia(dt).filter((f) => f.size > 0)
  if (files.length > 0) {
    return { type: 'media-files', files }
  }

  const html = getDataSafe(dt, 'text/html')
  const uriList = getDataSafe(dt, 'text/uri-list')
  const plain = (getDataSafe(dt, 'text/plain') || getDataSafe(dt, 'text')).trim()
  const downloadRaw =
    getDataSafe(dt, 'DownloadURL') || getDataSafe(dt, 'downloadurl')

  const mediaFromHtml = html ? parseHtmlDrop(html).mediaUrls : []
  const mediaFromDownload = parseDownloadUrls(downloadRaw)
    .map((d) => {
      const kind =
        classifyMedia(d.name, d.mime) ||
        mediaKindFromUrl(d.url) ||
        (d.mime.startsWith('video/') ? ('video' as const) : null) ||
        (d.mime.startsWith('image/') ? (d.mime === 'image/gif' ? ('gif' as const) : ('image' as const)) : null)
      if (!kind) return null
      return { url: d.url, kind, name: d.name || fileNameFromUrl(d.url) }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)

  const uris = uriList ? parseUriList(uriList) : []
  const mediaFromUris = uris
    .map((u) => {
      const kind = mediaKindFromUrl(u)
      if (!kind) return null
      return { url: u, kind, name: fileNameFromUrl(u) }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)

  // Prefer HTML-extracted media (user dragged an <img>/<video>)
  const mediaUrls = dedupeMediaUrls([
    ...mediaFromHtml,
    ...mediaFromDownload,
    ...mediaFromUris,
  ])

  if (mediaUrls.length > 0) {
    return { type: 'media-urls', urls: mediaUrls }
  }

  // 2) Single page / link URL → bookmark card
  const linkCandidate =
    uris.find((u) => looksLikeUrl(u) && !mediaKindFromUrl(u)) ||
    (html ? parseHtmlDrop(html).hrefs[0] : undefined) ||
    (plain && looksLikeUrl(plain) && !mediaKindFromUrl(plain) ? plain : undefined)

  if (linkCandidate) {
    return { type: 'link', url: normalizeUrl(linkCandidate) }
  }

  // Plain text that is itself a media URL (no html)
  if (plain && looksLikeUrl(plain)) {
    const kind = mediaKindFromUrl(plain)
    if (kind) {
      return {
        type: 'media-urls',
        urls: [{ url: normalizeUrl(plain), kind, name: fileNameFromUrl(plain) }],
      }
    }
    return { type: 'link', url: normalizeUrl(plain) }
  }

  // 3) Selected text → note card
  if (plain) {
    return { type: 'text', text: plain }
  }

  return { type: 'empty' }
}

function dedupeMediaUrls(
  list: Array<{ url: string; kind: 'image' | 'gif' | 'video'; name?: string }>,
) {
  const seen = new Set<string>()
  const out: typeof list = []
  for (const item of list) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    out.push(item)
  }
  return out
}

/** Download remote media for display (PureRef-style embed). */
async function resolveRemoteMediaSrc(
  url: string,
  kind: 'image' | 'gif' | 'video',
): Promise<string> {
  // Videos: prefer direct URL (data URLs are too large); try blob fetch first
  if (kind === 'video') {
    try {
      const res = await fetch(url, { mode: 'cors' })
      if (res.ok) {
        const blob = await res.blob()
        if (blob.size > 0 && blob.size < 80 * 1024 * 1024) {
          return URL.createObjectURL(blob)
        }
      }
    } catch {
      /* CORS or network */
    }
    return url
  }

  // Images on desktop: native proxy → data URL (handles hotlink / CORS)
  if (isDesktop()) {
    try {
      const data = await invoke<string>('proxy_image_data_url', {
        url,
        referer: null,
      })
      if (data?.startsWith('data:')) return data
    } catch {
      /* fall through */
    }
  }

  // Browser / fallback: fetch → blob URL
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (res.ok) {
      const blob = await res.blob()
      if (blob.size > 0) return URL.createObjectURL(blob)
    }
  } catch {
    /* ignore */
  }

  // Last resort: use remote URL directly (may work for some CDNs)
  return url
}

/**
 * Place whatever was dropped at world coordinates.
 * Returns true if something was imported.
 */
export async function importDropAt(
  worldX: number,
  worldY: number,
  dt: DataTransfer,
): Promise<boolean> {
  const payload = parseDropDataTransfer(dt)
  const store = useCanvasStore.getState()

  if (payload.type === 'media-files') {
    let z = store.nextZ
    const raw: CanvasItem[] = []
    for (const file of payload.files) {
      const item = await createMediaFromFile(file, worldX, worldY, z++)
      if (item) raw.push(item)
    }
    if (!raw.length) return false
    store.addItems(placeItemsTight(raw, worldX, worldY, 4))
    return true
  }

  if (payload.type === 'media-urls') {
    let z = store.nextZ
    const raw: CanvasItem[] = []
    for (const m of payload.urls) {
      try {
        const src = await resolveRemoteMediaSrc(m.url, m.kind)
        const name =
          m.name ||
          fileNameFromUrl(m.url) ||
          `dropped.${getExtension(m.url) || (m.kind === 'video' ? 'mp4' : 'png')}`
        const item = await createMediaItemFromSrc(
          src,
          name,
          m.kind,
          worldX,
          worldY,
          z++,
        )
        raw.push(item)
      } catch (e) {
        console.warn('Failed to import remote media', m.url, e)
      }
    }
    if (!raw.length) {
      // Could not load media — fall back to link cards so drop is not a no-op
      for (const m of payload.urls) {
        store.addLinkCard({ x: worldX, y: worldY }, m.url)
      }
      return true
    }
    store.addItems(placeItemsTight(raw, worldX, worldY, 4))
    return true
  }

  if (payload.type === 'link') {
    store.addLinkCard({ x: worldX, y: worldY }, payload.url)
    return true
  }

  if (payload.type === 'text') {
    store.addTextCard({ x: worldX, y: worldY }, { content: payload.text })
    return true
  }

  return false
}
