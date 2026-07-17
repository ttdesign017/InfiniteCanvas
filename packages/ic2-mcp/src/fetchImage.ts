/**
 * Download an image URL for create_image / research cluster (Node).
 */

import { BoardOpsError } from '../../../src/board-ops/errors'

const MAX_BYTES = 12 * 1024 * 1024

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true
  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true
  if (h === 'metadata.google.internal') return true
  return false
}

/** Best-effort natural size from common image headers (no decode). */
function probeImageDimensions(
  buf: Uint8Array,
  mime: string,
): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' || (buf[0] === 0x89 && buf[1] === 0x50)) {
      if (buf.length < 24) return null
      const width =
        (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]
      const height =
        (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]
      if (width > 0 && height > 0 && width < 20000 && height < 20000) {
        return { width, height }
      }
    }
    if (
      mime === 'image/jpeg' ||
      mime === 'image/jpg' ||
      (buf[0] === 0xff && buf[1] === 0xd8)
    ) {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) break
        const marker = buf[i + 1]
        if (marker === 0xd9 || marker === 0xda) break
        const len = (buf[i + 2] << 8) | buf[i + 3]
        // SOF0 / SOF2
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          const height = (buf[i + 5] << 8) | buf[i + 6]
          const width = (buf[i + 7] << 8) | buf[i + 8]
          if (width > 0 && height > 0) return { width, height }
          break
        }
        if (len < 2) break
        i += 2 + len
      }
    }
    if (mime === 'image/gif' || (buf[0] === 0x47 && buf[1] === 0x49)) {
      if (buf.length < 10) return null
      const width = buf[6] | (buf[7] << 8)
      const height = buf[8] | (buf[9] << 8)
      if (width > 0 && height > 0) return { width, height }
    }
  } catch {
    /* ignore */
  }
  return null
}

export async function fetchImageAsDataUrl(
  url: string,
): Promise<{
  dataUrl: string
  mime: string
  fileName: string
  width?: number
  height?: number
}> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new BoardOpsError('INVALID_PATCH', `Invalid image URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BoardOpsError(
      'WRITE_DENIED',
      'Only http(s) image URLs are allowed',
    )
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new BoardOpsError(
      'WRITE_DENIED',
      `Blocked private host: ${parsed.hostname}`,
    )
  }

  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'InfiniteCanvas2-MCP/0.1' },
  })
  if (!res.ok) {
    throw new BoardOpsError(
      'OPEN_FAILED',
      `Image fetch failed HTTP ${res.status}`,
      url,
    )
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength === 0) {
    throw new BoardOpsError('OPEN_FAILED', 'Empty image body', url)
  }
  if (buf.byteLength > MAX_BYTES) {
    throw new BoardOpsError(
      'BOARD_TOO_LARGE',
      `Image too large (${Math.ceil(buf.byteLength / (1024 * 1024))} MB)`,
    )
  }
  let mime = res.headers.get('content-type')?.split(';')[0]?.trim() || ''
  if (!mime.startsWith('image/')) {
    if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png'
    else if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg'
    else if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif'
    else mime = 'image/jpeg'
  }
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk))
  }
  const b64 = btoa(binary)
  const fileName =
    decodeURIComponent(parsed.pathname.split('/').pop() || 'image') ||
    'image.jpg'
  const dims = probeImageDimensions(buf, mime)
  return {
    dataUrl: `data:${mime};base64,${b64}`,
    ...(dims ? { width: dims.width, height: dims.height } : {}),
    mime,
    fileName: fileName.slice(0, 180),
  }
}
