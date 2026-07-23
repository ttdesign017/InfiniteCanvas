/**
 * Infinite Canvas project file format (.icanvas)
 *
 * Unique JSON document that embeds media as base64 so boards open offline
 * even after original files are deleted.
 */

import type {
  BoardSnapshot,
  AudioItem,
  CanvasItem,
  MediaItem,
  StackRecord,
  Viewport,
} from '../types/canvas'
import { trackBlobUrl } from './blobUrls'
import { isDesktop, readBinaryFile } from './desktop'
import { mapPool } from './mapPool'
import { getExtension } from './media'
import {
  getCachedPackAsset,
  setCachedPackAsset,
} from './packAssetCache'

/** Concurrent media loads while packing .icanvas (I/O bound). */
export const PACK_MEDIA_CONCURRENCY = 6

export const ICANVAS_MAGIC = 'ICNV'
export const ICANVAS_FORMAT = 'InfiniteCanvas'
export const ICANVAS_EXT = 'icanvas'
/** Current on-disk format version */
export const ICANVAS_FORMAT_VERSION = 3
/**
 * Hard cap on raw JSON text size (~512 MiB).
 * Boards with many embedded media often land in the 200–400 MB range;
 * multi-GB files are still rejected to avoid OOMing the WebView during JSON.parse.
 */
export const ICANVAS_MAX_TEXT_BYTES = 512 * 1024 * 1024

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
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/opus',
    wma: 'audio/x-ms-wma',
    aiff: 'audio/aiff',
    aif: 'audio/aiff',
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

function isMediaItem(item: CanvasItem): item is MediaItem | AudioItem {
  return (
    item.type === 'image' ||
    item.type === 'gif' ||
    item.type === 'video' ||
    item.type === 'audio'
  )
}

type PackedItemResult = {
  item: CanvasItem
  assets: Record<string, ICanvasAsset>
}

async function loadSrcAsAssetCached(
  src: string,
  fileName?: string,
): Promise<ICanvasAsset | null> {
  const cached = getCachedPackAsset(src, fileName)
  if (cached) return cached
  const packed = await loadSrcAsAsset(src, fileName)
  if (packed) setCachedPackAsset(src, fileName, packed)
  return packed
}

async function packOneItem(item: CanvasItem): Promise<PackedItemResult> {
  if (isMediaItem(item)) {
    const assetId = item.id
    const packed = await loadSrcAsAssetCached(item.src, item.fileName)
    if (packed) {
      return {
        item: { ...item, src: `${ASSET_PREFIX}${assetId}` },
        assets: { [assetId]: packed },
      }
    }
    // Keep original src if pack failed (better than dropping the item)
    return { item: { ...item }, assets: {} }
  }

  // Link cards: embed preview image / favicon when they are data or fetchable remote
  if (item.type === 'link') {
    const next = { ...item }
    const assets: Record<string, ICanvasAsset> = {}
    if (item.image) {
      const imgAsset = await loadSrcAsAssetCached(item.image)
      if (imgAsset) {
        const aid = `${item.id}_img`
        assets[aid] = imgAsset
        next.image = `${ASSET_PREFIX}${aid}`
      }
    }
    if (item.favicon) {
      const fav = await loadSrcAsAssetCached(item.favicon)
      if (fav) {
        const aid = `${item.id}_fav`
        assets[aid] = fav
        next.favicon = `${ASSET_PREFIX}${aid}`
      }
    }
    return { item: next, assets }
  }

  return { item: structuredClone(item), assets: {} }
}

/**
 * Pack current board + embed all media into an .icanvas document.
 * Media loads run with limited concurrency (see {@link PACK_MEDIA_CONCURRENCY}).
 */
export async function packICanvasDocument(snapshot: BoardSnapshot): Promise<ICanvasDocument> {
  const packed = await mapPool(
    snapshot.items,
    PACK_MEDIA_CONCURRENCY,
    (item) => packOneItem(item),
  )

  const assets: Record<string, ICanvasAsset> = {}
  const items: CanvasItem[] = []
  for (const row of packed) {
    items.push(row.item)
    Object.assign(assets, row.assets)
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
 * Decode raw base64 (no data: prefix) into a Blob without building a giant
 * intermediate data-URL string (open-path memory win).
 */
export function base64ToBlob(b64: string, mime: string): Blob | null {
  try {
    const cleaned = b64.replace(/\s/g, '')
    if (!cleaned) return null
    const binary = atob(cleaned)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime || 'application/octet-stream' })
  } catch {
    return null
  }
}

/** base64 + mime → tracked blob: object URL (null on failure). */
export function base64ToObjectUrl(b64: string, mime: string): string | null {
  const blob = base64ToBlob(b64, mime)
  if (!blob || blob.size === 0) return null
  try {
    return trackBlobUrl(URL.createObjectURL(blob))
  } catch {
    return null
  }
}

/**
 * Expand a packed document into a BoardSnapshot.
 *
 * Media stays as `icanvas-asset://` refs plus {@link BoardSnapshot.packedAssets}
 * so blob object URLs are only created in {@link materializeRuntimeMediaSources}
 * *after* the previous board's blobs are revoked (avoids peak double-copy and
 * revoke races on open).
 */
export function unpackICanvasDocument(doc: ICanvasDocument): BoardSnapshot {
  return {
    version: 1,
    name: doc.name || 'Untitled Board',
    viewport: doc.viewport,
    homeViewport: doc.homeViewport
      ? { ...doc.homeViewport }
      : undefined,
    items: structuredClone(doc.items),
    nextZ: doc.nextZ ?? 1,
    stacks: doc.stacks ? structuredClone(doc.stacks) : [],
    currentContainerId: doc.currentContainerId,
    packedAssets: doc.assets ? { ...doc.assets } : undefined,
  }
}

/** Parse a data: URL into a Blob (null if not base64 data URL / decode fails). */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = dataUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/i)
  if (!m) return null
  return base64ToBlob(m[2], m[1] || 'application/octet-stream')
}

/**
 * Turn a data: URL into a tracked blob: object URL for &lt;video&gt;/&lt;audio&gt;/&lt;img&gt;.
 * Returns null if conversion fails (caller keeps the original src).
 */
export function dataUrlToObjectUrl(dataUrl: string): string | null {
  const blob = dataUrlToBlob(dataUrl)
  if (!blob || blob.size === 0) return null
  try {
    return trackBlobUrl(URL.createObjectURL(blob))
  } catch {
    return null
  }
}

/**
 * Runtime media sources that &lt;video&gt;/&lt;audio&gt; can actually play in WebView2.
 * `data:` is fine for small images but unreliable for video/audio (no frames / no play).
 */
export function isPlayableMediaSrc(src: string | undefined | null): boolean {
  if (!src) return false
  if (src.startsWith('blob:')) return true
  if (/^https?:\/\//i.test(src)) return true
  if (src.startsWith('asset:') || src.includes('asset.localhost')) return true
  // file / convertFileSrc paths
  if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('\\\\')) return true
  // data: images often work; video/audio data: is NOT considered playable here
  if (src.startsWith('data:image/')) return true
  return false
}

/**
 * Resolve packed asset refs and leftover `data:` URLs to tracked blob: URLs.
 * Prefer base64 → Blob directly (no intermediate data: string) when
 * `packedAssets` is provided from {@link unpackICanvasDocument}.
 *
 * Safe to call more than once (blob: / http sources are left alone).
 * Must run **after** `revokeAllTrackedBlobUrls` when replacing a board.
 */
export function materializeRuntimeMediaSources(
  items: CanvasItem[],
  packedAssets?: Record<string, ICanvasAsset> | null,
): CanvasItem[] {
  const assets = packedAssets || {}

  const resolveRef = (ref: string | undefined): string | undefined => {
    if (!ref) return ref
    if (ref.startsWith(ASSET_PREFIX)) {
      const id = ref.slice(ASSET_PREFIX.length)
      const a = assets[id]
      if (!a?.data) return ref
      return base64ToObjectUrl(a.data, a.mime) ?? `data:${a.mime};base64,${a.data}`
    }
    if (ref.startsWith('data:')) {
      return dataUrlToObjectUrl(ref) ?? ref
    }
    return ref
  }

  return items.map((raw) => {
    if (isMediaItem(raw)) {
      const src = resolveRef(raw.src)
      if (src === raw.src) return raw
      return { ...raw, src: src || raw.src }
    }
    if (raw.type === 'link') {
      const image = resolveRef(raw.image)
      const favicon = resolveRef(raw.favicon)
      if (image === raw.image && favicon === raw.favicon) return raw
      return { ...raw, image, favicon }
    }
    return raw
  })
}

export function serializeICanvas(doc: ICanvasDocument): string {
  return JSON.stringify(doc)
}

export function parseICanvasFile(text: string): BoardSnapshot {
  // UTF-16 code units ≈ upper bound on storage; reject before parse
  if (text.length > ICANVAS_MAX_TEXT_BYTES) {
    throw new Error(
      `File is too large to open (max ~${Math.round(ICANVAS_MAX_TEXT_BYTES / (1024 * 1024))} MB of JSON text)`,
    )
  }

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

/**
 * Post-save / post-pack integrity checks used by boardIO.
 * Throws with a clear message when the document is inconsistent.
 */
export function assertICanvasIntegrity(
  doc: ICanvasDocument,
  expected: { itemCount: number; stackCount: number },
): void {
  if (doc.magic !== ICANVAS_MAGIC || doc.format !== ICANVAS_FORMAT) {
    throw new Error('Save verification failed: missing ICNV document header')
  }
  if (typeof doc.formatVersion !== 'number') {
    throw new Error('Save verification failed: missing formatVersion')
  }
  if (!Array.isArray(doc.items) || doc.items.length !== expected.itemCount) {
    throw new Error(
      `Save verification failed: expected ${expected.itemCount} items, found ${doc.items?.length ?? 0}`,
    )
  }
  const stackCount = Array.isArray(doc.stacks) ? doc.stacks.length : 0
  if (stackCount !== expected.stackCount) {
    throw new Error(
      `Save verification failed: expected ${expected.stackCount} stacks, found ${stackCount}`,
    )
  }
  const assets = doc.assets || {}
  for (const item of doc.items) {
    if (
      item.type === 'image' ||
      item.type === 'gif' ||
      item.type === 'video' ||
      item.type === 'audio'
    ) {
      const src = item.src
      if (typeof src === 'string' && src.startsWith(ASSET_PREFIX)) {
        const id = src.slice(ASSET_PREFIX.length)
        const a = assets[id]
        if (!a?.data) {
          throw new Error(
            `Save verification failed: media asset missing for item ${item.id}`,
          )
        }
      }
    }
    if (item.type === 'link') {
      for (const ref of [item.image, item.favicon]) {
        if (typeof ref === 'string' && ref.startsWith(ASSET_PREFIX)) {
          const id = ref.slice(ASSET_PREFIX.length)
          if (!assets[id]?.data) {
            throw new Error(
              `Save verification failed: link asset missing for item ${item.id}`,
            )
          }
        }
      }
    }
  }
}
