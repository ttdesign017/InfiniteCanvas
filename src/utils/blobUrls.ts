/**
 * Track blob: object URLs created for canvas media so we can revoke them
 * when they are no longer referenced by the live board *or* undo history.
 */

const tracked = new Set<string>()

/** Register a blob URL (no-op for non-blob strings). Returns the same url. */
export function trackBlobUrl(url: string): string {
  if (url.startsWith('blob:')) tracked.add(url)
  return url
}

export function isTrackedBlobUrl(url: string | undefined | null): boolean {
  return !!url && url.startsWith('blob:') && tracked.has(url)
}

/** Revoke if this is a blob URL. Safe to call with any string. */
export function revokeBlobUrl(url: string | undefined | null): void {
  if (!url || !url.startsWith('blob:')) return
  try {
    URL.revokeObjectURL(url)
  } catch {
    /* ignore */
  }
  tracked.delete(url)
}

type Blobish = {
  type: string
  src?: string
  image?: string
  favicon?: string
}

/** Collect every blob: URL referenced by a set of items. */
export function collectBlobUrlsFromItems(items: Blobish[]): Set<string> {
  const out = new Set<string>()
  for (const item of items) {
    if (
      (item.type === 'image' || item.type === 'gif' || item.type === 'video') &&
      item.src?.startsWith('blob:')
    ) {
      out.add(item.src)
    }
    if (item.type === 'link') {
      if (item.image?.startsWith('blob:')) out.add(item.image)
      if (item.favicon?.startsWith('blob:')) out.add(item.favicon)
    }
  }
  return out
}

/** Revoke media / link image blobs on a canvas item (best-effort). */
export function revokeItemBlobUrls(item: Blobish): void {
  if (item.type === 'image' || item.type === 'gif' || item.type === 'video') {
    revokeBlobUrl(item.src)
  }
  if (item.type === 'link') {
    revokeBlobUrl(item.image)
    revokeBlobUrl(item.favicon)
  }
}

/**
 * Revoke blob URLs that appear in `prevItems` but are not in `stillReferenced`.
 * Always pass live items + every history/future snapshot's items so undo stays valid.
 */
export function revokeUnreferencedBlobs(
  candidates: Blobish[],
  stillReferenced: Set<string>,
): void {
  const seen = new Set<string>()
  for (const item of candidates) {
    const urls: string[] = []
    if (
      (item.type === 'image' || item.type === 'gif' || item.type === 'video') &&
      item.src?.startsWith('blob:')
    ) {
      urls.push(item.src)
    }
    if (item.type === 'link') {
      if (item.image?.startsWith('blob:')) urls.push(item.image)
      if (item.favicon?.startsWith('blob:')) urls.push(item.favicon)
    }
    for (const url of urls) {
      if (seen.has(url) || stillReferenced.has(url)) continue
      seen.add(url)
      revokeBlobUrl(url)
    }
  }
}

/** Drop every tracked blob (full board replace with no undo to keep). */
export function revokeAllTrackedBlobUrls(): void {
  for (const url of [...tracked]) {
    revokeBlobUrl(url)
  }
  tracked.clear()
}
