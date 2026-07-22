import { invoke } from '@tauri-apps/api/core'
import { trackBlobUrl } from './blobUrls'
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

// ─── Site-specific providers (X / YouTube block generic scrapers) ───────────

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  't.co',
])

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (!YT_HOSTS.has(host) && !host.endsWith('.youtube.com')) return null

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      return id && /^[\w-]{6,}$/.test(id) ? id : null
    }

    const v = u.searchParams.get('v')
    if (v && /^[\w-]{6,}$/.test(v)) return v

    const parts = u.pathname.split('/').filter(Boolean)
    // /shorts/ID, /embed/ID, /live/ID, /v/ID
    if (
      parts.length >= 2 &&
      ['shorts', 'embed', 'live', 'v'].includes(parts[0].toLowerCase())
    ) {
      const id = parts[1]
      if (id && /^[\w-]{6,}$/.test(id)) return id
    }
  } catch {
    /* ignore */
  }
  return null
}

export function extractXStatusId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (!X_HOSTS.has(host)) return null
    // /user/status/ID or /i/web/status/ID or /i/status/ID
    const m = u.pathname.match(/\/status(?:es)?\/(\d{1,25})(?:\/|$)/i)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

function youtubeThumbCandidates(videoId: string): string[] {
  // maxres can 404 for old/low-res uploads; hq/mq always exist
  return [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  ]
}

/** Prefer a thumbnail that actually exists (maxres 404s are common). */
async function pickYouTubeThumbnail(videoId: string): Promise<string> {
  const candidates = youtubeThumbCandidates(videoId)
  for (const src of candidates) {
    try {
      // HEAD is enough; some CDNs reject CORS on HEAD — fall through to img load probe
      const res = await fetch(src, { method: 'HEAD', mode: 'no-cors' })
      // no-cors opaque: treat as ok and let <img> decide; try first few with real GET
      void res
    } catch {
      /* continue */
    }
  }

  // Real existence check without CORS: Image()
  for (const src of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const img = new Image()
      img.referrerPolicy = 'no-referrer'
      const timer = window.setTimeout(() => {
        img.src = ''
        resolve(false)
      }, 4000)
      img.onload = () => {
        window.clearTimeout(timer)
        // maxresdefault sometimes returns a tiny grey 120x90 placeholder
        const w = img.naturalWidth
        const h = img.naturalHeight
        resolve(w >= 200 && h >= 120)
      }
      img.onerror = () => {
        window.clearTimeout(timer)
        resolve(false)
      }
      img.src = src
    })
    if (ok) return src
  }
  return candidates[2] // hqdefault is the safe default
}

async function fetchYouTubePreview(url: string): Promise<LinkPreviewMeta | null> {
  const videoId = extractYouTubeVideoId(url)
  if (!videoId) return null

  let title: string | undefined
  let author: string | undefined

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`,
    )}&format=json`
    const res = await fetch(oembedUrl)
    if (res.ok) {
      const data = (await res.json()) as {
        title?: string
        author_name?: string
        thumbnail_url?: string
      }
      title = data.title?.trim() || undefined
      author = data.author_name?.trim() || undefined
      // Prefer oEmbed thumbnail when present, still upgrade to higher-res if possible
      if (data.thumbnail_url) {
        const upgraded = await pickYouTubeThumbnail(videoId)
        return {
          title,
          description: author ? `${author} · YouTube` : 'YouTube',
          image: upgraded || data.thumbnail_url,
          favicon: faviconFor('https://www.youtube.com'),
          siteName: 'YouTube',
        }
      }
    }
  } catch {
    /* fall through to thumbnail-only */
  }

  const image = await pickYouTubeThumbnail(videoId)
  return {
    title: title || `YouTube · ${videoId}`,
    description: author ? `${author} · YouTube` : 'YouTube',
    image,
    favicon: faviconFor('https://www.youtube.com'),
    siteName: 'YouTube',
  }
}

function betterAvatarUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  // Twitter CDN size suffixes: _normal, _bigger, _mini, _200x200, _400x400
  return url
    .replace(/_normal(\.\w+)(\?.*)?$/i, '_400x400$1$2')
    .replace(/_bigger(\.\w+)(\?.*)?$/i, '_400x400$1$2')
    .replace(/_mini(\.\w+)(\?.*)?$/i, '_400x400$1$2')
    .replace(/_200x200(\.\w+)(\?.*)?$/i, '_400x400$1$2')
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/**
 * Pull the best preview image from fxtwitter / vxtwitter JSON.
 * Important: X Articles put the cover under `article`, NOT `media.photos`.
 * Example: https://x.com/LexnLin/status/2076422557180608888
 */
function extractXImageFromTweet(tweet: Record<string, unknown>): string | undefined {
  // 1) Classic photo / video media
  const media = asRecord(tweet.media)
  if (media) {
    const photos = media.photos as Array<Record<string, unknown>> | undefined
    const videos = media.videos as Array<Record<string, unknown>> | undefined
    const all = media.all as Array<Record<string, unknown>> | undefined
    const fromPhoto = asString(photos?.[0]?.url)
    const fromVideo =
      asString(videos?.[0]?.thumbnail_url) || asString(videos?.[0]?.url)
    const fromAllPhoto = all?.find((m) => m.type === 'photo' || m.type === 'image')
    const fromAll =
      asString(fromAllPhoto?.url) ||
      asString(all?.[0]?.thumbnail_url) ||
      asString(all?.[0]?.url)
    if (fromPhoto || fromVideo || fromAll) return fromPhoto || fromVideo || fromAll
  }

  const mediaUrls = tweet.mediaURLs as unknown
  if (Array.isArray(mediaUrls) && mediaUrls.length) {
    const u = asString(mediaUrls[0])
    if (u) return u
  }

  const mediaExt = tweet.media_extended as Array<Record<string, unknown>> | undefined
  if (Array.isArray(mediaExt) && mediaExt.length) {
    const photo = mediaExt.find((m) => m.type === 'image' || m.type === 'photo')
    const u =
      asString(photo?.url) ||
      asString(mediaExt[0]?.thumbnail_url) ||
      asString(mediaExt[0]?.url)
    if (u) return u
  }

  // 2) X Articles (long-form) — cover lives under article, media is often null
  const article = asRecord(tweet.article)
  if (article) {
    // vxtwitter: article.image
    const articleImage = asString(article.image)
    if (articleImage) return articleImage

    // fxtwitter: article.cover_media.media_info.original_img_url
    const cover = asRecord(article.cover_media)
    const mediaInfo = asRecord(cover?.media_info)
    const original =
      asString(mediaInfo?.original_img_url) ||
      asString(mediaInfo?.original_img_url_https) ||
      asString(cover?.url) ||
      asString(cover?.media_url_https)
    if (original) return original
  }

  // 3) Twitter card (summary_large_image etc.)
  const card = asRecord(tweet.twitter_card) || asRecord(tweet.card)
  if (card) {
    const cardImage =
      asString(card.image) ||
      asString(card.image_url) ||
      asString(asRecord(card.binding_values)?.photo_image_full_size) ||
      asString(asRecord(asRecord(card.binding_values)?.thumbnail_image)?.url)
    if (cardImage) return cardImage

    // nested image object
    const imgObj = asRecord(card.image)
    const nested = asString(imgObj?.url) || asString(imgObj?.src)
    if (nested) return nested
  }

  return undefined
}

function extractXArticleMeta(tweet: Record<string, unknown>): {
  title?: string
  description?: string
} {
  const article = asRecord(tweet.article)
  if (!article) return {}
  return {
    title: asString(article.title),
    description:
      asString(article.preview_text) ||
      asString(article.description) ||
      asString(article.preview),
  }
}

/** Normalize pbs.twimg.com URLs for more reliable browser display */
export function normalizeTwimgUrl(url: string): string {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('twimg.com')) return url
    // Ensure https
    u.protocol = 'https:'
    // Banner paths without size often work, but /1500x500 is more consistent
    if (u.pathname.includes('/profile_banners/') && !/\/\d+x\d+\/?$/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/?$/, '/1500x500')
    }
    // Prefer name=small/medium for large media (faster, less likely to fail)
    if (u.pathname.includes('/media/') && !u.searchParams.has('name')) {
      u.searchParams.set('name', 'small')
    }
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Public image proxy fallback when CDNs block hotlinks / WebView referrers.
 * Used in browser and as desktop fallback when native proxy fails.
 */
export function proxiedImageUrl(url: string): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url
  if (url.includes('wsrv.nl') || url.includes('images.weserv.nl')) return url
  try {
    const host = new URL(url).hostname
    if (
      !/twimg\.com$|twitter\.com$|ytimg\.com$|ggpht\.com$|fbcdn\.net$|cdninstagram\.com$/i.test(
        host,
      )
    ) {
      return url
    }
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}&n=-1`
  } catch {
    return url
  }
}

function xImageIsRealMedia(image: string | undefined): boolean {
  if (!image) return false
  const raw = (() => {
    try {
      const u = new URL(image)
      const nested = u.searchParams.get('url')
      return nested || image
    } catch {
      return image
    }
  })()
  return !/profile_images|profile_banners/.test(raw)
}

function mergeXCandidates(
  best: LinkPreviewMeta | null,
  candidate: LinkPreviewMeta,
): LinkPreviewMeta {
  if (!best) return candidate
  const prevImage = best.image || ''
  const candImage = candidate.image || ''
  const upgradeMedia =
    Boolean(candImage) &&
    Boolean(prevImage) &&
    /profile_images|profile_banners/.test(prevImage) &&
    !/profile_images|profile_banners/.test(candImage)

  if ((!best.image && candidate.image) || upgradeMedia) {
    return {
      title: candidate.title || best.title,
      description: candidate.description || best.description,
      image: candidate.image || best.image,
      favicon: candidate.favicon || best.favicon,
      siteName: candidate.siteName || best.siteName,
    }
  }
  return {
    title: best.title || candidate.title,
    description: best.description || candidate.description,
    image: best.image || candidate.image,
    favicon: best.favicon || candidate.favicon,
    siteName: best.siteName || candidate.siteName,
  }
}

function parseXProviderJson(
  json: Record<string, unknown>,
  screenFromUrl: string,
): LinkPreviewMeta | null {
  // fxtwitter: { code, tweet }; vxtwitter: flat fields
  const tweet =
    asRecord(json.tweet) ||
    (asString(json.tweetID) || asString(json.tweetURL) || asString(json.text)
      ? json
      : null)
  if (!tweet) return null

  const articleMeta = extractXArticleMeta(tweet)
  const text =
    asString(tweet.text) ||
    asString(tweet.full_text) ||
    asString(asRecord(tweet.raw_text)?.text) ||
    ''

  const author = asRecord(tweet.author) || asRecord(tweet.user) || {}

  const screenName =
    asString(author.screen_name) ||
    asString(author.screenName) ||
    asString(tweet.user_screen_name) ||
    screenFromUrl ||
    ''

  const displayName =
    asString(author.name) || asString(tweet.user_name) || screenName

  const avatar = betterAvatarUrl(
    asString(author.avatar_url) ||
      asString(author.profile_image_url_https) ||
      asString(tweet.user_profile_image_url),
  )

  let banner =
    asString(author.banner_url) || asString(tweet.user_banner_url) || undefined
  if (banner) banner = normalizeTwimgUrl(banner)

  let image = extractXImageFromTweet(tweet)
  if (image) image = normalizeTwimgUrl(image)

  // Fallback: banner / avatar so text-only posts still get a thumb
  if (!image) image = banner || (avatar ? normalizeTwimgUrl(avatar) : undefined)

  // In browser, route twimg through image proxy for reliability
  if (image && !isDesktop()) {
    image = proxiedImageUrl(image)
  }

  const handle = screenName ? `@${screenName.replace(/^@/, '')}` : ''
  const authorLabel =
    (displayName && handle ? `${displayName} (${handle})` : displayName || handle) ||
    'Post on X'

  // Prefer article title when this is an X Article share
  const title = articleMeta.title || authorLabel
  const description =
    (articleMeta.description || text).trim().slice(0, 280) ||
    (articleMeta.title ? authorLabel : 'X')

  return {
    title,
    description,
    image,
    favicon: faviconFor('https://x.com'),
    siteName: 'X',
  }
}

async function fetchXEndpoint(
  endpoint: string,
  screenFromUrl: string,
  timeoutMs: number,
): Promise<LinkPreviewMeta | null> {
  try {
    const res = await withTimeout(
      fetch(endpoint).then(async (r) => {
        if (!r.ok) return null
        return (await r.json()) as Record<string, unknown>
      }),
      timeoutMs,
      null,
    )
    if (!res) return null
    return parseXProviderJson(res, screenFromUrl)
  } catch (e) {
    console.warn('X preview provider failed', endpoint, e)
    return null
  }
}

async function fetchXPreview(url: string): Promise<LinkPreviewMeta | null> {
  const statusId = extractXStatusId(url)
  if (!statusId) return null

  // FixTweet / FxTwitter / VxTwitter — public unauthenticated APIs, CORS *
  // Race providers in parallel: one slow endpoint used to block the whole card.
  let screenFromUrl = ''
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    if (parts[0] && parts[0] !== 'i' && parts[0] !== 'status') {
      screenFromUrl = parts[0]
    }
  } catch {
    /* ignore */
  }

  const endpoints = [
    `https://api.fxtwitter.com/status/${statusId}`,
    screenFromUrl
      ? `https://api.vxtwitter.com/${encodeURIComponent(screenFromUrl)}/status/${statusId}`
      : '',
    `https://api.vxtwitter.com/Twitter/status/${statusId}`,
  ].filter(Boolean)

  // Per-provider budget; parallel so total wait ≈ slowest success, not sum.
  const perEndpointMs = 8000
  const results = await Promise.all(
    endpoints.map((endpoint) => fetchXEndpoint(endpoint, screenFromUrl, perEndpointMs)),
  )

  let best: LinkPreviewMeta | null = null
  for (const candidate of results) {
    if (!candidate) continue
    best = mergeXCandidates(best, candidate)
    // Prefer real media as soon as any provider has it
    if (xImageIsRealMedia(best.image)) {
      // Still merge remaining results that already finished (they're in `results`)
      // — nothing left to wait for since Promise.all settled.
    }
  }

  return best
}

/**
 * Prefer site-native APIs for platforms that block bot HTML scrapes.
 * Returns null when the URL is not a known special host.
 */
async function fetchSiteSpecificPreview(
  url: string,
): Promise<LinkPreviewMeta | null> {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (YT_HOSTS.has(host) || host.endsWith('.youtube.com')) {
      return fetchYouTubePreview(url)
    }
    if (X_HOSTS.has(host)) {
      return fetchXPreview(url)
    }
  } catch {
    /* ignore */
  }
  return null
}

async function ensureDisplayableImage(
  image: string | undefined,
  pageUrl: string,
): Promise<string | undefined> {
  if (!image) return undefined
  if (image.startsWith('data:')) return image

  // Desktop: always proxy http(s) images into data URLs for WebView
  if (isDesktop() && /^https?:\/\//i.test(image)) {
    // Twitter / YT CDNs often reject page referers — try empty first for media CDNs
    const host = (() => {
      try {
        return new URL(image).hostname
      } catch {
        return ''
      }
    })()
    const isMediaCdn =
      /ytimg\.com$|youtube\.com$|twimg\.com$|twitter\.com$|fbcdn\.net$|cdninstagram\.com$/i.test(
        host,
      )

    if (isMediaCdn) {
      const proxied = await proxyImageToDataUrl(image, '')
      if (proxied?.startsWith('data:')) return proxied
    }

    const proxied = await proxyImageToDataUrl(image, pageUrl)
    if (proxied?.startsWith('data:')) return proxied

    // Same public proxy the browser uses when native download fails
    const publicProxy = proxiedImageUrl(image)
    if (publicProxy !== image) {
      try {
        const res = await fetch(publicProxy, { mode: 'cors' })
        if (res.ok) {
          const blob = await res.blob()
          if (blob.size > 0) return trackBlobUrl(URL.createObjectURL(blob))
        }
      } catch {
        /* ignore */
      }
      // Return proxied URL so <img> can still attempt load with no-referrer
      return publicProxy
    }

    // Do not throw away a valid OG URL merely because native proxying failed.
    return image
  }

  // Browser: pre-route known hotlink-blocked CDNs
  if (!isDesktop() && /^https?:\/\//i.test(image)) {
    return proxiedImageUrl(image)
  }

  return image
}

function mergeMeta(
  primary: LinkPreviewMeta | null,
  fallback: LinkPreviewMeta | null,
): LinkPreviewMeta | null {
  if (!primary && !fallback) return null
  if (!primary) return fallback
  if (!fallback) return primary
  return {
    title: primary.title || fallback.title,
    description: primary.description || fallback.description,
    image: primary.image || fallback.image,
    favicon: primary.favicon || fallback.favicon,
    siteName: primary.siteName || fallback.siteName,
  }
}

/** Overall hard budget — X providers can be slow; still avoid infinite spinners. */
const LINK_PREVIEW_BUDGET_MS = 16000
/** Site-native X/YT path (parallel providers inside). */
const SITE_SPECIFIC_BUDGET_MS = 9000
/** Desktop native HTML/OG scrape (often fails on X; not on the hot path when site wins). */
const NATIVE_SCRAPE_BUDGET_MS = 7000
const IMAGE_PROXY_BUDGET_MS = 5000
const MICROLINK_BUDGET_MS = 5000

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(fallback)
      }
    }, ms)
    promise.then(
      (v) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(v)
        }
      },
      () => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(fallback)
        }
      },
    )
  })
}

/** URLs that already failed or timed out — skip re-fetch loops in the same session. */
const previewGaveUp = new Set<string>()

export function linkPreviewHasGaveUp(url: string): boolean {
  return previewGaveUp.has(normalizeUrl(url) || url)
}

/** Allow a manual retry after a failed/timeout preview for this URL. */
export function clearLinkPreviewGaveUp(url: string): void {
  const normalized = normalizeUrl(url) || url
  previewGaveUp.delete(normalized)
  if (url !== normalized) previewGaveUp.delete(url)
}

function isSpecialPreviewHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return (
      X_HOSTS.has(host) ||
      YT_HOSTS.has(host) ||
      host.endsWith('.youtube.com')
    )
  } catch {
    return false
  }
}

/**
 * When site-native APIs already returned a usable card, skip slow HTML scrapes
 * (x.com closes sockets / starves generic clients). Still proxy the image on desktop.
 */
async function finalizeSitePreview(
  site: LinkPreviewMeta,
  pageUrl: string,
): Promise<LinkPreviewMeta> {
  const image = await withTimeout(
    ensureDisplayableImage(site.image, pageUrl),
    IMAGE_PROXY_BUDGET_MS,
    site.image || null,
  )
  let favicon = site.favicon
  if (
    isDesktop() &&
    favicon &&
    !favicon.startsWith('data:') &&
    /^https?:\/\//i.test(favicon)
  ) {
    favicon =
      (await withTimeout(proxyImageToDataUrl(favicon, pageUrl), 2500, null)) ||
      faviconFor(pageUrl)
  }
  return {
    ...site,
    image: image || undefined,
    favicon: favicon || faviconFor(pageUrl),
  }
}

/**
 * Fetch Open Graph metadata for a Notion-style bookmark card.
 * YouTube / X use dedicated APIs (generic HTML scrape is blocked).
 * Desktop also proxies images to data URLs for WebView2.
 *
 * Hard budget (~16s): never hang the UI spinner forever.
 * X/YT take a fast path and skip native HTML scrape when media is already present.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewMeta | null> {
  const normalized = normalizeUrl(url)
  if (!normalized || !/^https?:\/\//i.test(normalized)) return null
  if (previewGaveUp.has(normalized)) return null

  const run = async (): Promise<LinkPreviewMeta | null> => {
    // 1) Site-specific first — X/YouTube rarely expose real OG media to scrapers
    const site = await withTimeout(
      fetchSiteSpecificPreview(normalized),
      SITE_SPECIFIC_BUDGET_MS,
      null,
    )

    // Fast path: special hosts with usable metadata — skip Tauri HTML scrape.
    // x.com often hangs or starves generic scrapers; waiting on them made cards
    // time out even after fxtwitter/vxtwitter already returned.
    if (site && isSpecialPreviewHost(normalized) && (site.image || site.title)) {
      return finalizeSitePreview(site, normalized)
    }

    if (isDesktop()) {
      const native = await withTimeout(
        fetchViaTauri(normalized),
        NATIVE_SCRAPE_BUDGET_MS,
        null,
      )
      let combined = mergeMeta(site, native)

      if (site?.image && !combined?.image) {
        combined = mergeMeta(combined, site)
      }

      if (combined) {
        const image = await withTimeout(
          ensureDisplayableImage(combined.image, normalized),
          IMAGE_PROXY_BUDGET_MS,
          combined.image || null,
        )
        let favicon = combined.favicon
        if (favicon && !favicon.startsWith('data:') && /^https?:\/\//i.test(favicon)) {
          favicon =
            (await withTimeout(
              proxyImageToDataUrl(favicon, normalized),
              2500,
              null,
            )) || faviconFor(normalized)
        } else if (!favicon) {
          const fallback = faviconFor(normalized)
          favicon =
            (await withTimeout(
              proxyImageToDataUrl(fallback, normalized),
              2000,
              null,
            )) || undefined
        }

        if (!image) {
          const remote = await withTimeout(
            fetchViaMicrolink(normalized),
            MICROLINK_BUDGET_MS,
            null,
          )
          if (remote?.image) {
            const remoteImg = await withTimeout(
              ensureDisplayableImage(remote.image, normalized),
              IMAGE_PROXY_BUDGET_MS,
              remote.image || null,
            )
            return {
              title: combined.title || remote.title,
              description: combined.description || remote.description,
              image: remoteImg || undefined,
              favicon: favicon || remote.favicon || faviconFor(normalized),
              siteName: combined.siteName || remote.siteName,
            }
          }
        }

        if (combined.title || combined.description || image) {
          return {
            ...combined,
            image: image || undefined,
            favicon: favicon || faviconFor(normalized),
          }
        }
      }

      const remote = await withTimeout(
        fetchViaMicrolink(normalized),
        MICROLINK_BUDGET_MS,
        null,
      )
      if (remote) {
        const image = await withTimeout(
          ensureDisplayableImage(remote.image, normalized),
          IMAGE_PROXY_BUDGET_MS,
          remote.image || null,
        )
        return {
          ...remote,
          image: image || undefined,
          favicon: remote.favicon || faviconFor(normalized),
        }
      }

      if (site) {
        return finalizeSitePreview(site, normalized)
      }

      return null
    }

    // Browser: site-specific → microlink
    if (site?.image || site?.title) {
      if (!site.title || !site.description) {
        const remote = await withTimeout(
          fetchViaMicrolink(normalized),
          MICROLINK_BUDGET_MS,
          null,
        )
        const merged = mergeMeta(site, remote)
        if (merged) {
          return {
            ...merged,
            favicon: merged.favicon || faviconFor(normalized),
          }
        }
      }
      return {
        ...site,
        favicon: site.favicon || faviconFor(normalized),
      }
    }

    const remote = await withTimeout(
      fetchViaMicrolink(normalized),
      MICROLINK_BUDGET_MS,
      null,
    )
    if (remote) {
      return {
        ...remote,
        favicon: remote.favicon || faviconFor(normalized),
      }
    }

    return site
  }

  try {
    const result = await withTimeout(run(), LINK_PREVIEW_BUDGET_MS, null)
    if (!result) previewGaveUp.add(normalized)
    return result
  } catch {
    previewGaveUp.add(normalized)
    return null
  }
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
