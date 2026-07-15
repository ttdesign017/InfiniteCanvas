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
  if (!/^https?:\/\//i.test(src)) return null

  const width = parseSize(matchAttr(text, 'width'), DEFAULT_W)
  const height = parseSize(matchAttr(text, 'height'), DEFAULT_H)
  // Prefer explicit height; style="height:175" fallback
  const styleH = matchStylePx(text, 'height')
  const styleW = matchStylePx(text, 'width')
  const maxW = matchStylePx(text, 'max-width')

  const w = Math.min(900, Math.max(200, styleW || maxW || width || DEFAULT_W))
  const h = Math.min(900, Math.max(80, styleH || height || DEFAULT_H))

  // Prefer source allow/sandbox; defaults match Apple Podcast embeds (audio + play)
  const allow =
    matchAttr(text, 'allow') ||
    'autoplay *; encrypted-media *; fullscreen *; clipboard-write *'
  // Prefer source sandbox, but strip breakout flags if the paste included them
  const rawSandbox =
    matchAttr(text, 'sandbox') ||
    [
      'allow-forms',
      'allow-popups',
      'allow-same-origin',
      'allow-scripts',
      'allow-presentation',
    ].join(' ')
  const sandbox = rawSandbox
    .split(/\s+/)
    .filter(
      (tok) =>
        tok &&
        tok !== 'allow-top-navigation' &&
        tok !== 'allow-top-navigation-by-user-activation' &&
        tok !== 'allow-popups-to-escape-sandbox' &&
        tok !== 'allow-top-navigation-to-custom-protocols',
    )
    .join(' ')
  const title = matchAttr(text, 'title') || undefined

  const html = [
    '<iframe',
    ` src="${escapeAttr(src)}"`,
    ` width="100%"`,
    ` height="100%"`,
    ` style="width:100%;height:100%;border:0;border-radius:10px;overflow:hidden;"`,
    ` allow="${escapeAttr(allow)}"`,
    ` sandbox="${escapeAttr(sandbox)}"`,
    ` loading="eager"`,
    ` referrerpolicy="no-referrer-when-downgrade"`,
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
