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
  } catch {
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
        logo?: { url?: string }
        publisher?: string
      }
    }
    if (json.status !== 'success' || !json.data) return null
    const d = json.data
    return {
      title: d.title || undefined,
      description: d.description || undefined,
      image: d.image?.url || undefined,
      favicon: d.logo?.url || faviconFor(url),
      siteName: d.publisher || undefined,
    }
  } catch {
    return null
  }
}

/**
 * Fetch Open Graph / page metadata for a Notion-style bookmark card.
 * Prefer Tauri native HTTP (no CORS); fall back to microlink in browser.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewMeta | null> {
  const normalized = normalizeUrl(url)
  if (!normalized || !/^https?:\/\//i.test(normalized)) return null

  if (isDesktop()) {
    const native = await fetchViaTauri(normalized)
    if (native && (native.title || native.description || native.image)) {
      return {
        ...native,
        favicon: native.favicon || faviconFor(normalized),
      }
    }
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
