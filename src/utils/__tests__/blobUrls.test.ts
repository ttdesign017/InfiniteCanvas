import { afterEach, describe, expect, it } from 'vitest'
import {
  collectBlobUrlsFromItems,
  isTrackedBlobUrl,
  revokeAllTrackedBlobUrls,
  revokeUnreferencedBlobs,
  trackBlobUrl,
} from '../blobUrls'

afterEach(() => {
  revokeAllTrackedBlobUrls()
})

describe('blob URL tracking', () => {
  it('tracks and recognizes blob URLs only', () => {
    const url = trackBlobUrl(URL.createObjectURL(new Blob(['x'])))
    expect(url.startsWith('blob:')).toBe(true)
    expect(isTrackedBlobUrl(url)).toBe(true)
    expect(isTrackedBlobUrl('data:image/png;base64,AQID')).toBe(false)
    expect(isTrackedBlobUrl('https://example.com/a.png')).toBe(false)
  })

  it('collects media and link blob refs from items', () => {
    const a = trackBlobUrl(URL.createObjectURL(new Blob(['a'])))
    const b = trackBlobUrl(URL.createObjectURL(new Blob(['b'])))
    const items = [
      {
        type: 'video',
        src: a,
      },
      {
        type: 'link',
        image: b,
        favicon: 'https://example.com/f.ico',
      },
      {
        type: 'image',
        src: 'data:image/png;base64,AQID',
      },
    ]
    const set = collectBlobUrlsFromItems(items)
    expect(set.has(a)).toBe(true)
    expect(set.has(b)).toBe(true)
    expect(set.size).toBe(2)
  })

  it('revokes unreferenced blobs while keeping URLs still in live items', () => {
    const keep = trackBlobUrl(URL.createObjectURL(new Blob(['keep'])))
    const drop = trackBlobUrl(URL.createObjectURL(new Blob(['drop'])))
    expect(isTrackedBlobUrl(keep)).toBe(true)
    expect(isTrackedBlobUrl(drop)).toBe(true)

    revokeUnreferencedBlobs(
      [
        { type: 'video', src: keep },
        { type: 'audio', src: drop },
      ],
      new Set([keep]),
    )

    expect(isTrackedBlobUrl(keep)).toBe(true)
    expect(isTrackedBlobUrl(drop)).toBe(false)
  })

  it('revokeAllTrackedBlobUrls clears every tracked URL', () => {
    const a = trackBlobUrl(URL.createObjectURL(new Blob(['1'])))
    const b = trackBlobUrl(URL.createObjectURL(new Blob(['2'])))
    revokeAllTrackedBlobUrls()
    expect(isTrackedBlobUrl(a)).toBe(false)
    expect(isTrackedBlobUrl(b)).toBe(false)
  })
})
