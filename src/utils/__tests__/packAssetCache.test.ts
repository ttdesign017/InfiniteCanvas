import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPackAssetCache,
  getCachedPackAsset,
  packAssetCacheSize,
  setCachedPackAsset,
} from '../packAssetCache'

afterEach(() => {
  clearPackAssetCache()
})

describe('packAssetCache', () => {
  it('stores and retrieves by src + fileName', () => {
    setCachedPackAsset('blob:abc', 'a.png', {
      mime: 'image/png',
      data: 'AQID',
      fileName: 'a.png',
    })
    const hit = getCachedPackAsset('blob:abc', 'a.png')
    expect(hit).toEqual({
      mime: 'image/png',
      data: 'AQID',
      fileName: 'a.png',
    })
    expect(getCachedPackAsset('blob:other', 'a.png')).toBeNull()
  })

  it('returns copies so mutations do not poison the cache', () => {
    setCachedPackAsset('blob:x', undefined, {
      mime: 'image/png',
      data: 'AAAA',
    })
    const a = getCachedPackAsset('blob:x')!
    a.data = 'HACK'
    expect(getCachedPackAsset('blob:x')!.data).toBe('AAAA')
  })

  it('clear empties the cache', () => {
    setCachedPackAsset('blob:1', undefined, { mime: 'x', data: '1' })
    expect(packAssetCacheSize()).toBe(1)
    clearPackAssetCache()
    expect(packAssetCacheSize()).toBe(0)
  })
})
