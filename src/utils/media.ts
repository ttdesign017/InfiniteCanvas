import type { AudioItem, MediaItem } from '../types/canvas'
import { isDesktop, localPathToSrc, readBinaryFile } from './desktop'
import { trackBlobUrl } from './blobUrls'
import { uid } from './id'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg', 'avif', 'ico', 'heic'])
const GIF_EXT = new Set(['gif'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv', 'm4v'])
const AUDIO_EXT = new Set([
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus',
  'wma', 'aiff', 'aif',
])

export type MediaKind = 'image' | 'gif' | 'video' | 'audio'

/** Max bytes to load into a blob for image/gif parity with browser File drops */
const MAX_BLOB_EMBED_BYTES = 40 * 1024 * 1024

export function getExtension(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function classifyMedia(fileName: string, mime?: string): MediaKind | null {
  const ext = getExtension(fileName)
  if (GIF_EXT.has(ext) || mime === 'image/gif') return 'gif'
  if (VIDEO_EXT.has(ext) || mime?.startsWith('video/')) return 'video'
  if (AUDIO_EXT.has(ext) || mime?.startsWith('audio/')) return 'audio'
  if (IMAGE_EXT.has(ext) || mime?.startsWith('image/')) return 'image'
  if (mime?.startsWith('video/')) return 'video'
  return null
}

export function pathToFileUrl(filePath: string): string {
  return localPathToSrc(filePath)
}

function mimeFromFileName(fileName: string, kind: MediaKind): string {
  const ext = getExtension(fileName)
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    ico: 'image/x-icon',
    heic: 'image/heic',
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
  if (map[ext]) return map[ext]
  if (kind === 'video') return 'video/mp4'
  if (kind === 'audio') return 'audio/mpeg'
  if (kind === 'gif') return 'image/gif'
  return 'image/png'
}

/**
 * Decode file:// URLs (and Windows path variants) to a filesystem path.
 * Used when HTML5 DnD / uri-list exposes local paths instead of File blobs.
 */
export function fileUrlToPath(urlOrPath: string): string | null {
  const raw = urlOrPath.trim()
  if (!raw) return null

  // Already a filesystem path
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    return raw.replace(/\//g, '\\')
  }
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw
  }

  if (!/^file:/i.test(raw)) return null

  try {
    // Prefer URL parser for correct decoding
    const u = new URL(raw)
    let path = decodeURIComponent(u.pathname)

    // Windows: file:///C:/Users/... → /C:/Users/... → C:\Users\...
    if (/^\/[a-zA-Z]:/.test(path)) {
      path = path.slice(1)
    }
    // file://localhost/C:/... hostname may be localhost
    if (u.hostname && u.hostname !== 'localhost' && u.hostname.length === 1) {
      path = `${u.hostname}:${path}`
    }

    if (/^[a-zA-Z]:/.test(path) || path.startsWith('\\\\')) {
      return path.replace(/\//g, '\\')
    }
    if (path.startsWith('/')) return path
  } catch {
    /* fall through */
  }

  // Manual fallback for odd encodings
  let path = decodeURIComponent(raw.replace(/^file:\/\//i, ''))
  path = path.replace(/^\/+/, '')
  if (/^[a-zA-Z]:/.test(path)) return path.replace(/\//g, '\\')
  if (path.startsWith('localhost/')) {
    path = path.slice('localhost/'.length)
    if (/^[a-zA-Z]:/.test(path)) return path.replace(/\//g, '\\')
  }
  return null
}

/** Chromium/WebView sometimes exposes a non-standard absolute path on File */
export function fileSystemPathFromFile(file: File): string | null {
  const anyFile = file as File & { path?: string; mozFullPath?: string }
  const p = anyFile.path || anyFile.mozFullPath
  if (p && typeof p === 'string' && p.length > 0) {
    return fileUrlToPath(p) || p
  }
  return null
}

function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 })
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

function loadVideoSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth || 640,
        height: video.videoHeight || 360,
      })
      video.src = ''
    }
    video.onerror = () => reject(new Error('Failed to load video'))
    video.src = src
  })
}

export async function createMediaItemFromSrc(
  src: string,
  fileName: string,
  kind: MediaKind,
  x: number,
  y: number,
  zIndex: number,
): Promise<MediaItem | AudioItem> {
  if (kind === 'audio') {
    return {
      id: uid(kind),
      type: 'audio',
      src,
      fileName,
      x,
      y,
      width: 324,
      height: 84,
      rotation: 0,
      zIndex,
    }
  }
  const size =
    kind === 'video' ? await loadVideoSize(src).catch(() => ({ width: 640, height: 360 })) : await loadImageSize(src).catch(() => ({ width: 400, height: 300 }))

  // Canvas size = original pixel dimensions (do not unify / downscale on import)
  const width = Math.max(1, Math.round(size.width))
  const height = Math.max(1, Math.round(size.height))

  return {
    id: uid(kind),
    type: kind,
    src,
    fileName,
    naturalWidth: size.width,
    naturalHeight: size.height,
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex,
  }
}

export async function createMediaFromFile(
  file: File,
  x: number,
  y: number,
  zIndex: number,
): Promise<MediaItem | AudioItem | null> {
  const kind = classifyMedia(file.name, file.type)
  if (!kind) {
    // WebView2 can yield empty type + size-0 File stubs; fall back to path
    const path = fileSystemPathFromFile(file)
    if (path) return createMediaFromPath(path, x, y, zIndex)
    return null
  }

  // Prefer blob when content is present (browser parity)
  if (file.size > 0) {
    const src = trackBlobUrl(URL.createObjectURL(file))
    return createMediaItemFromSrc(src, file.name || 'media', kind, x, y, zIndex)
  }

  // Empty FileList stubs: use native path when available
  const path = fileSystemPathFromFile(file)
  if (path) return createMediaFromPath(path, x, y, zIndex)

  // Last resort: try blob anyway (some webviews fill content lazily)
  try {
    const src = trackBlobUrl(URL.createObjectURL(file))
    return createMediaItemFromSrc(src, file.name || 'media', kind, x, y, zIndex)
  } catch {
    return null
  }
}

export async function createMediaFromPath(
  filePath: string,
  x: number,
  y: number,
  zIndex: number,
): Promise<MediaItem | AudioItem | null> {
  const normalized = fileUrlToPath(filePath) || filePath
  const fileName = normalized.split(/[/\\]/).pop() || 'media'
  const kind = classifyMedia(fileName)
  if (!kind) return null

  // Images/gifs: read bytes → blob URL (same display path as browser File drops).
  // Videos: prefer asset protocol so large files are not fully buffered.
  if (isDesktop() && kind !== 'video' && kind !== 'audio') {
    try {
      const bytes = await readBinaryFile(normalized)
      if (bytes?.length && bytes.length <= MAX_BLOB_EMBED_BYTES) {
        // Copy into a plain ArrayBuffer-backed Uint8Array for BlobPart typing
        const copy = new Uint8Array(bytes.byteLength)
        copy.set(bytes)
        const blob = new Blob([copy], { type: mimeFromFileName(fileName, kind) })
        const src = trackBlobUrl(URL.createObjectURL(blob))
        return createMediaItemFromSrc(src, fileName, kind, x, y, zIndex)
      }
    } catch (e) {
      console.warn('createMediaFromPath readBinaryFile failed, using asset URL', normalized, e)
    }
  }

  const src = pathToFileUrl(normalized)
  return createMediaItemFromSrc(src, fileName, kind, x, y, zIndex)
}
