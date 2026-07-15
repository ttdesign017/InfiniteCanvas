/**
 * Parse pasted embed snippets (primarily <iframe …>).
 */

export interface ParsedEmbed {
  src: string
  html: string
  width: number
  height: number
  title?: string
}

const DEFAULT_W = 660
const DEFAULT_H = 175

const TRUSTED_EMBED_HOSTS = new Set([
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'open.spotify.com',
  'embed.podcasts.apple.com',
  'embed.music.apple.com',
  'w.soundcloud.com',
  'www.figma.com',
  'codepen.io',
  'player.twitch.tv',
])

export const EMBED_ALLOW =
  'autoplay; encrypted-media; fullscreen; picture-in-picture'

export const EMBED_SANDBOX = [
  'allow-same-origin',
  'allow-scripts',
  'allow-presentation',
].join(' ')

export function isTrustedEmbedSrc(src: string): boolean {
  try {
    const url = new URL(src)
    return url.protocol === 'https:' && TRUSTED_EMBED_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

/** Detect and parse an iframe embed from clipboard text */
export function parseEmbedHtml(raw: string): ParsedEmbed | null {
  const text = raw.trim()
  if (!text) return null
  // Must look like an iframe (allow leading whitespace / comments)
  if (!/<iframe[\s>]/i.test(text)) return null

  const src =
    matchAttr(text, 'src') ||
    // Some snippets use srcdoc only — skip those for now
    null
  if (!src) return null
  if (!isTrustedEmbedSrc(src)) return null

  const width = parseSize(matchAttr(text, 'width'), DEFAULT_W)
  const height = parseSize(matchAttr(text, 'height'), DEFAULT_H)
  // Prefer explicit height; style="height:175" fallback
  const styleH = matchStylePx(text, 'height')
  const styleW = matchStylePx(text, 'width')
  const maxW = matchStylePx(text, 'max-width')

  const w = Math.min(900, Math.max(200, styleW || maxW || width || DEFAULT_W))
  const h = Math.min(900, Math.max(80, styleH || height || DEFAULT_H))

  const title = matchAttr(text, 'title') || undefined

  const html = [
    '<iframe',
    ` src="${escapeAttr(src)}"`,
    ` width="100%"`,
    ` height="100%"`,
    ` style="width:100%;height:100%;border:0;border-radius:10px;overflow:hidden;"`,
    ` allow="${escapeAttr(EMBED_ALLOW)}"`,
    ` sandbox="${escapeAttr(EMBED_SANDBOX)}"`,
    ` loading="eager"`,
    ` referrerpolicy="no-referrer"`,
    title ? ` title="${escapeAttr(title)}"` : '',
    '></iframe>',
  ].join('')

  return { src, html, width: w, height: h, title }
}

function matchAttr(html: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i')
  const m = html.match(re)
  return m ? m[1].trim() : null
}

function matchStylePx(html: string, prop: string): number | null {
  const style = matchAttr(html, 'style')
  if (!style) return null
  const re = new RegExp(`${prop}\\s*:\\s*([\\d.]+)px`, 'i')
  const m = style.match(re)
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}

function parseSize(raw: string | null, fallback: number): number {
  if (!raw) return fallback
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
