/**
 * Keep-alive cache for embed iframes.
 *
 * Enter/exit stack unmounts React trees that are not in the current container.
 * Without this, every navigation destroys and reloads the iframe (audio stops,
 * player state resets, visible flash).
 *
 * Strategy: create each iframe once, reparent into the active host, and park
 * detached nodes in a hidden off-screen pool instead of destroying them.
 * Chromium/WebView2 preserves iframe browsing context across same-document moves.
 */

const EMBED_ALLOW =
  'autoplay *; encrypted-media *; fullscreen *; clipboard-write *'
const EMBED_SANDBOX = [
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-same-origin',
  'allow-scripts',
  'allow-presentation',
  'allow-top-navigation-by-user-activation',
].join(' ')

const cache = new Map<string, HTMLIFrameElement>()

let parkEl: HTMLDivElement | null = null

function ensurePark(): HTMLDivElement {
  if (parkEl && document.body.contains(parkEl)) return parkEl
  const el = document.createElement('div')
  el.id = 'embed-iframe-park'
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'width:1px',
    'height:1px',
    'overflow:hidden',
    'opacity:0',
    'pointer-events:none',
    'z-index:-1',
  ].join(';')
  document.body.appendChild(el)
  parkEl = el
  return el
}

function applyChrome(iframe: HTMLIFrameElement, title?: string) {
  iframe.title = title || 'Embed'
  iframe.setAttribute('allow', EMBED_ALLOW)
  iframe.setAttribute('sandbox', EMBED_SANDBOX)
  iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade')
  iframe.setAttribute('loading', 'eager')
  // Layout fills the host; pointer-events toggled by the view
  iframe.style.cssText = [
    'display:block',
    'width:100%',
    'height:100%',
    'border:0',
    'border-radius:10px',
    'background:#f7f7f7',
    'transform:translateZ(0)',
    'backface-visibility:hidden',
  ].join(';')
}

/** Attach (or create) a cached iframe into `host`. Safe to call every render cycle. */
export function attachEmbedIframe(
  host: HTMLElement,
  id: string,
  src: string,
  title?: string,
): HTMLIFrameElement {
  let iframe = cache.get(id)

  if (!iframe) {
    iframe = document.createElement('iframe')
    iframe.dataset.embedId = id
    iframe.dataset.embedSrc = src
    applyChrome(iframe, title)
    // Assign src only on create — re-setting the same src reloads in some engines
    iframe.src = src
    cache.set(id, iframe)
  } else {
    applyChrome(iframe, title)
    // Src change (rare): must reload
    if (iframe.dataset.embedSrc !== src) {
      iframe.dataset.embedSrc = src
      iframe.src = src
    }
  }

  if (iframe.parentElement !== host) {
    host.appendChild(iframe)
  }
  return iframe
}

/** Detach without destroying — keeps player state / audio. */
export function parkEmbedIframe(id: string) {
  const iframe = cache.get(id)
  if (!iframe) return
  const park = ensurePark()
  if (iframe.parentElement !== park) {
    park.appendChild(iframe)
  }
  iframe.style.pointerEvents = 'none'
}

export function setEmbedIframePointerEvents(
  id: string,
  enabled: boolean,
) {
  const iframe = cache.get(id)
  if (!iframe) return
  iframe.style.pointerEvents = enabled ? 'auto' : 'none'
}

export function destroyEmbedIframe(id: string) {
  const iframe = cache.get(id)
  if (!iframe) return
  iframe.remove()
  cache.delete(id)
}

/** Drop iframes for embed items that no longer exist on the board. */
export function pruneEmbedIframes(liveIds: Iterable<string>) {
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds)
  for (const id of [...cache.keys()]) {
    if (!live.has(id)) destroyEmbedIframe(id)
  }
}

export function hasCachedEmbedIframe(id: string): boolean {
  return cache.has(id)
}
