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

export async function fetchImageAsDataUrl(
  url: string,
): Promise<{ dataUrl: string; mime: string; fileName: string }> {
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
  return {
    dataUrl: `data:${mime};base64,${b64}`,
    mime,
    fileName: fileName.slice(0, 180),
  }
}
