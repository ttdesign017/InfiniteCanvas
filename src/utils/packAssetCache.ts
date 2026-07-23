/**
 * Session cache for packed .icanvas media assets.
 * Second save of the same `src` reuses base64 instead of re-fetching / re-encoding.
 */

import type { ICanvasAsset } from './boardFile'

type Entry = {
  asset: ICanvasAsset
  /** LRU bookkeeping */
  lastUsed: number
}

const MAX_ENTRIES = 256
const cache = new Map<string, Entry>()

export function packAssetCacheKey(src: string, fileName?: string): string {
  // src is the runtime identity (blob:/asset path/data:). fileName is secondary.
  return `${src}\n${fileName || ''}`
}

export function getCachedPackAsset(
  src: string,
  fileName?: string,
): ICanvasAsset | null {
  if (!src) return null
  const key = packAssetCacheKey(src, fileName)
  const hit = cache.get(key)
  if (!hit) return null
  hit.lastUsed = performance.now()
  // Return a shallow copy so callers cannot mutate the cache entry
  return {
    mime: hit.asset.mime,
    data: hit.asset.data,
    fileName: hit.asset.fileName,
  }
}

export function setCachedPackAsset(
  src: string,
  fileName: string | undefined,
  asset: ICanvasAsset,
): void {
  if (!src || !asset?.data) return
  const key = packAssetCacheKey(src, fileName)
  cache.set(key, {
    asset: {
      mime: asset.mime,
      data: asset.data,
      fileName: asset.fileName ?? fileName,
    },
    lastUsed: performance.now(),
  })
  trimIfNeeded()
}

/** Drop cache entries (e.g. after closing a board). Optional. */
export function clearPackAssetCache(): void {
  cache.clear()
}

/**
 * Keep only entries whose src is still live on the board.
 * Keys are `${src}\n${fileName}` — match by src prefix.
 */
export function prunePackAssetCache(liveSrcs: ReadonlySet<string>): number {
  let removed = 0
  for (const key of [...cache.keys()]) {
    const src = key.split('\n')[0] ?? ''
    if (!liveSrcs.has(src)) {
      cache.delete(key)
      removed++
    }
  }
  return removed
}

export function packAssetCacheSize(): number {
  return cache.size
}

function trimIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return
  const entries = [...cache.entries()].sort(
    (a, b) => a[1].lastUsed - b[1].lastUsed,
  )
  const drop = cache.size - MAX_ENTRIES
  for (let i = 0; i < drop; i++) {
    cache.delete(entries[i][0])
  }
}
