import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './desktop'

export interface LinkPreviewMeta {
  title?: string
  description?: string
  image?: string
  favicon?: string
  siteName?: string
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function guessTitleFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    if (!path || path === '/') return extractDomain(url)
    const last = path.split('/').filter(Boolean).pop() || extractDomain(url)
    return decodeURIComponent(last)
      .replace(/[-_]+/g, ' ')
      .replace(/\.\w+$/, '')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  } catch {
    return url
  }
}

export function faviconFor(url: string): string {
  try {
    const host = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return ''
  }
}

/** Instant local placeholder before remote OG fetch completes */
export function placeholderPreview(url: string): {
  title: string
  description: string
  favicon?: string
} {
  const normalized = normalizeUrl(url)
  return {
    title: normalized ? guessTitleFromUrl(normalized) : 'Untitled link',
    description: normalized ? extractDomain(normalized) : 'Add a URL',
    favicon: normalized ? faviconFor(normalized) || undefined : undefined,
  }
}

async function fetchViaTauri(url: string): Promise<LinkPreviewMeta | null> {
  try {
    const data = await invoke<LinkPreviewMeta>('fetch_link_preview', { url })
    return data ?? null
  } catch (e) {
    console.warn('fetch_link_preview failed', e)
    return null
  }
}

/** Proxy remote image → data URL via Rust (for WebView display) */
export async function proxyImageToDataUrl(
  imageUrl: string,
  referer?: string,
): Promise<string | null> {
  if (!imageUrl) return null
  if (imageUrl.startsWith('data:')) return imageUrl
  if (!isDesktop()) return imageUrl
  try {
    return await invoke<string>('proxy_image_data_url', {
      url: imageUrl,
      referer: referer || null,
    })
  } catch (e) {
    console.warn('proxy_image_data_url failed', e)
    return null
  }
}

/** Browser / fallback: microlink public API (CORS-friendly) */
async function fetchViaMicrolink(url: string): Promise<LinkPreviewMeta | null> {
  try {
    const endpoint = `https://api.microlink.io?url=${encodeURIComponent(url)}&palette=false&audio=false&video=false&iframe=false`
    const res = await fetch(endpoint)
    if (!res.ok) return null
    const json = (await res.json()) as {
      status: string
      data?: {
        title?: string
        description?: string
        image?: { url?: string }
        screenshot?: { url?: string }
        logo?: { url?: string }
        publisher?: string
      }
    }
    if (json.status !== 'success' || !json.data) return null
    const d = json.data
    return {
      title: d.title || undefined,
      description: d.description || undefined,
      image: d.image?.url || d.screenshot?.url || undefined,
      favicon: d.logo?.url || faviconFor(url),
      siteName: d.publisher || undefined,
    }
  } catch {
    return null
  }
}

async function ensureDisplayableImage(
  image: string | undefined,
  pageUrl: string,
): Promise<string | undefined> {
  if (!image) return undefined
  if (image.startsWith('data:')) return image

  // Desktop: always proxy http(s) images into data URLs for WebView
  if (isDesktop() && /^https?:\/\//i.test(image)) {
    const proxied = await proxyImageToDataUrl(image, pageUrl)
    if (proxied?.startsWith('data:')) return proxied
    // Do not throw away a valid OG URL merely because native proxying failed.
    // WebView2 can display many CDN images directly.
    return image
  }

  return image
}

/**
 * Fetch Open Graph metadata for a Notion-style bookmark card.
 * Desktop: Tauri scrape + image proxy to data URL (required for packaged app).
 * Browser: microlink.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewMeta | null> {
  const normalized = normalizeUrl(url)
  if (!normalized || !/^https?:\/\//i.test(normalized)) return null

  if (isDesktop()) {
    let native = await fetchViaTauri(normalized)

    // Ensure image is a data: URL for the WebView
    if (native) {
      const image = await ensureDisplayableImage(native.image, normalized)
      let favicon = native.favicon
      if (favicon && !favicon.startsWith('data:') && /^https?:\/\//i.test(favicon)) {
        favicon = (await proxyImageToDataUrl(favicon, normalized)) || faviconFor(normalized)
      } else if (!favicon) {
        const fallback = faviconFor(normalized)
        favicon = (await proxyImageToDataUrl(fallback, normalized)) || undefined
      }

      // If still no image, try microlink (often has better OG extraction)
      if (!image) {
        const remote = await fetchViaMicrolink(normalized)
        if (remote?.image) {
          const remoteImg = await ensureDisplayableImage(remote.image, normalized)
          return {
            title: native.title || remote.title,
            description: native.description || remote.description,
            image: remoteImg,
            favicon: favicon || remote.favicon || faviconFor(normalized),
            siteName: native.siteName || remote.siteName,
          }
        }
      }

      if (native.title || native.description || image) {
        return {
          ...native,
          image,
          favicon: favicon || faviconFor(normalized),
        }
      }
    }

    // Full microlink fallback on desktop if native scrape failed
    const remote = await fetchViaMicrolink(normalized)
    if (remote) {
      const image = await ensureDisplayableImage(remote.image, normalized)
      return {
        ...remote,
        image,
        favicon: remote.favicon || faviconFor(normalized),
      }
    }

    return null
  }

  const remote = await fetchViaMicrolink(normalized)
  if (remote) {
    return {
      ...remote,
      favicon: remote.favicon || faviconFor(normalized),
    }
  }

  return null
}

export function mergePreview(
  url: string,
  preview: LinkPreviewMeta | null,
): {
  title: string
  description: string
  favicon?: string
  image?: string
  siteName?: string
} {
  const base = placeholderPreview(url)
  if (!preview) {
    return {
      title: base.title,
      description: base.description,
      favicon: base.favicon,
    }
  }

  const title = (preview.title || '').trim() || base.title
  const domain = extractDomain(url)
  const description =
    (preview.description || '').trim() ||
    (preview.siteName || '').trim() ||
    domain ||
    base.description

  return {
    title,
    description,
    favicon: preview.favicon || base.favicon,
    image: preview.image || undefined,
    siteName: preview.siteName || undefined,
  }
}
