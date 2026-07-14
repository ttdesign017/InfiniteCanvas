/**
 * Infinite Canvas project file format (.icanvas)
 *
 * Unique JSON document that embeds media as base64 so boards open offline
 * even after original files are deleted.
 */

import type {
  BoardSnapshot,
  CanvasItem,
  MediaItem,
  StackRecord,
  Viewport,
} from '../types/canvas'
import { isDesktop, readBinaryFile } from './desktop'
import { getExtension } from './media'

export const ICANVAS_MAGIC = 'ICNV'
export const ICANVAS_FORMAT = 'InfiniteCanvas'
export const ICANVAS_EXT = 'icanvas'
/** Current on-disk format version */
export const ICANVAS_FORMAT_VERSION = 3

export interface ICanvasAsset {
  mime: string
  /** Base64 (no data: prefix) */
  data: string
  fileName?: string
}

export interface ICanvasDocument {
  magic: typeof ICANVAS_MAGIC
  format: typeof ICANVAS_FORMAT
  formatVersion: number
  name: string
  viewport: Viewport
  /** Root-canvas viewport when the document was saved inside a nested stack. */
  homeViewport?: Viewport
  nextZ: number
  items: CanvasItem[]
  stacks?: StackRecord[]
  currentContainerId?: string
  /** Media blobs keyed by asset id */
  assets: Record<string, ICanvasAsset>
}

const ASSET_PREFIX = 'icanvas-asset://'

function mimeFromName(name?: string): string {
  const ext = getExtension(name || '')
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    m4v: 'video/mp4',
    ogv: 'video/ogg',
  }
  return map[ext] || 'application/octet-stream'
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Decode convertFileSrc / asset URL back to a filesystem path when possible */
export function srcToFilesystemPath(src: string): string | null {
  if (!src) return null
  // Already a Windows / POSIX path
  if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('\\\\') || src.startsWith('/')) {
    return src
  }
  try {
    // asset://localhost/C%3A%2F... or https://asset.localhost/...
    const u = new URL(src)
    if (
      u.protocol === 'asset:' ||
      u.hostname === 'asset.localhost' ||
      u.hostname === 'localhost'
    ) {
      let path = decodeURIComponent(u.pathname.replace(/^\//, ''))
      // Some builds use host as drive: asset://localhost/C:/...
      if (u.hostname && u.hostname.length === 1 && u.hostname !== 'l') {
        path = `${u.hostname}:${path}`
      }
      // Normalize asset.localhost path like /C:/Users/...
      if (/^[a-zA-Z]%3A/i.test(path) || /^[a-zA-Z]:/.test(path)) {
        path = decodeURIComponent(path)
      }
      if (/^[a-zA-Z]:/.test(path) || path.startsWith('/')) return path.replace(/\//g, '\\')
    }
  } catch {
    /* ignore */
  }
  return null
}

async function loadSrcAsAsset(
  src: string,
  fileName?: string,
): Promise<ICanvasAsset | null> {
  if (!src) return null

  // Already a data URL
  if (src.startsWith('data:')) {
    const m = src.match(/^data:([^;,]+);base64,([\s\S]+)$/i)
    if (m) {
      return { mime: m[1], data: m[2], fileName }
    }
    return null
  }

  // Blob from paste / file picker
  if (src.startsWith('blob:')) {
    try {
      const res = await fetch(src)
      const buf = new Uint8Array(await res.arrayBuffer())
      if (!buf.length) return null
      const mime = res.headers.get('content-type') || mimeFromName(fileName)
      return { mime, data: uint8ToBase64(buf), fileName }
    } catch {
      return null
    }
  }

  // Local path via Tauri fs
  const fsPath = srcToFilesystemPath(src)
  if (fsPath && isDesktop()) {
    try {
      const bytes = await readBinaryFile(fsPath)
      if (!bytes?.length) return null
      return {
        mime: mimeFromName(fileName || fsPath),
        data: uint8ToBase64(bytes),
        fileName: fileName || fsPath.split(/[/\\]/).pop(),
      }
    } catch {
      /* fall through to fetch */
    }
  }

  // asset.localhost / http(s) — try fetch (works for Tauri asset protocol in webview)
  if (/^(https?:|asset:)/i.test(src) || src.includes('asset.localhost')) {
    try {
      const res = await fetch(src)
      if (!res.ok) return null
      const buf = new Uint8Array(await res.arrayBuffer())
      if (!buf.length) return null
      const mime = res.headers.get('content-type') || mimeFromName(fileName)
      return { mime, data: uint8ToBase64(buf), fileName }
    } catch {
      return null
    }
  }

  return null
}

function isMediaItem(item: CanvasItem): item is MediaItem {
  return item.type === 'image' || item.type === 'gif' || item.type === 'video'
}

/**
 * Pack current board + embed all media into an .icanvas document.
 */
export async function packICanvasDocument(snapshot: BoardSnapshot): Promise<ICanvasDocument> {
  const assets: Record<string, ICanvasAsset> = {}
  const items: CanvasItem[] = []

  for (const item of snapshot.items) {
    if (isMediaItem(item)) {
      const assetId = item.id
      const packed = await loadSrcAsAsset(item.src, item.fileName)
      if (packed) {
        assets[assetId] = packed
        items.push({
          ...item,
          src: `${ASSET_PREFIX}${assetId}`,
        })
        continue
      }
      // Keep original src if pack failed (better than dropping the item)
      items.push({ ...item })
      continue
    }

    // Link cards: embed preview image / favicon when they are data or fetchable remote
    if (item.type === 'link') {
      const next = { ...item }
      if (item.image && !item.image.startsWith('data:')) {
        const imgAsset = await loadSrcAsAsset(item.image)
        if (imgAsset) {
          const aid = `${item.id}_img`
          assets[aid] = imgAsset
          next.image = `${ASSET_PREFIX}${aid}`
        }
      } else if (item.image?.startsWith('data:')) {
        const imgAsset = await loadSrcAsAsset(item.image)
        if (imgAsset) {
          const aid = `${item.id}_img`
          assets[aid] = imgAsset
          next.image = `${ASSET_PREFIX}${aid}`
        }
      }
      if (item.favicon && !item.favicon.startsWith('data:')) {
        const fav = await loadSrcAsAsset(item.favicon)
        if (fav) {
          const aid = `${item.id}_fav`
          assets[aid] = fav
          next.favicon = `${ASSET_PREFIX}${aid}`
        }
      }
      items.push(next)
      continue
    }

    items.push(structuredClone(item))
  }

  return {
    magic: ICANVAS_MAGIC,
    format: ICANVAS_FORMAT,
    formatVersion: ICANVAS_FORMAT_VERSION,
    name: snapshot.name,
    viewport: { ...snapshot.viewport },
    homeViewport: snapshot.homeViewport
      ? { ...snapshot.homeViewport }
      : undefined,
    nextZ: snapshot.nextZ,
    items,
    stacks: snapshot.stacks ? structuredClone(snapshot.stacks) : [],
    currentContainerId: snapshot.currentContainerId,
    assets,
  }
}

export function isICanvasDocument(data: unknown): data is ICanvasDocument {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    d.magic === ICANVAS_MAGIC &&
    d.format === ICANVAS_FORMAT &&
    typeof d.formatVersion === 'number' &&
    Array.isArray(d.items) &&
    typeof d.assets === 'object' &&
    d.assets !== null
  )
}

/** Accept legacy plain BoardSnapshot (version 1 JSON) for migration */
export function isLegacyBoardSnapshot(data: unknown): data is BoardSnapshot {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    (d.version === 1 || d.version === undefined) &&
    Array.isArray(d.items) &&
    typeof d.viewport === 'object' &&
    d.viewport !== null &&
    !('magic' in d)
  )
}

/**
 * Expand icanvas-asset:// refs to data: URLs for runtime use.
 */
export function unpackICanvasDocument(doc: ICanvasDocument): BoardSnapshot {
  const assets = doc.assets || {}

  const resolve = (ref: string | undefined): string | undefined => {
    if (!ref) return ref
    if (ref.startsWith(ASSET_PREFIX)) {
      const id = ref.slice(ASSET_PREFIX.length)
      const a = assets[id]
      if (!a) return ref
      return `data:${a.mime};base64,${a.data}`
    }
    return ref
  }

  const items = doc.items.map((raw) => {
    const item = structuredClone(raw) as CanvasItem
    if (isMediaItem(item)) {
      item.src = resolve(item.src) || item.src
    }
    if (item.type === 'link') {
      item.image = resolve(item.image)
      item.favicon = resolve(item.favicon)
    }
    return item
  })

  return {
    version: 1,
    name: doc.name || 'Untitled Board',
    viewport: doc.viewport,
    homeViewport: doc.homeViewport
      ? { ...doc.homeViewport }
      : undefined,
    items,
    nextZ: doc.nextZ ?? 1,
    stacks: doc.stacks ? structuredClone(doc.stacks) : [],
    currentContainerId: doc.currentContainerId,
  }
}

export function serializeICanvas(doc: ICanvasDocument): string {
  return JSON.stringify(doc)
}

export function parseICanvasFile(text: string): BoardSnapshot {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Unable to parse the file: invalid JSON')
  }

  if (isICanvasDocument(data)) {
    return unpackICanvasDocument(data)
  }
  if (isLegacyBoardSnapshot(data)) {
    return {
      version: 1,
      name: data.name || 'Untitled Board',
      viewport: data.viewport,
      homeViewport: data.homeViewport
        ? { ...data.homeViewport }
        : undefined,
      items: data.items,
      nextZ: data.nextZ ?? 1,
      stacks: data.stacks ?? [],
      currentContainerId: data.currentContainerId,
    }
  }
  throw new Error('Unable to open the file: not an Infinite Canvas project (.icanvas)')
}
