import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearVideoPosterCache,
  getVideoPoster,
  isMostlyBlackImageData,
  setVideoPoster,
  videoPosterCacheSize,
} from '../videoPosterCache'

afterEach(() => {
  clearVideoPosterCache()
})

describe('videoPosterCache', () => {
  it('stores and retrieves by item id', () => {
    setVideoPoster('v1', 'data:image/jpeg;base64,AAA')
    expect(getVideoPoster('v1')).toBe('data:image/jpeg;base64,AAA')
    expect(getVideoPoster('v2')).toBeNull()
  })

  it('prefers id+src key when present', () => {
    setVideoPoster('v1', 'data:image/jpeg;base64,OLD')
    setVideoPoster('v1', 'data:image/jpeg;base64,NEW', 'blob:x')
    expect(getVideoPoster('v1', 'blob:x')).toBe('data:image/jpeg;base64,NEW')
    expect(getVideoPoster('v1')).toBe('data:image/jpeg;base64,NEW')
  })

  it('rejects non-image data urls', () => {
    setVideoPoster('v1', 'not-an-image')
    expect(getVideoPoster('v1')).toBeNull()
    expect(videoPosterCacheSize()).toBe(0)
  })

  it('clear empties the cache', () => {
    setVideoPoster('v1', 'data:image/jpeg;base64,AAA')
    clearVideoPosterCache()
    expect(videoPosterCacheSize()).toBe(0)
    expect(getVideoPoster('v1')).toBeNull()
  })

  it('detects mostly-black canvases', () => {
    const ctx = {
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
    } as unknown as CanvasRenderingContext2D
    expect(isMostlyBlackImageData(ctx, 16, 16)).toBe(true)

    const bright = {
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([200, 180, 160, 255]) })),
    } as unknown as CanvasRenderingContext2D
    expect(isMostlyBlackImageData(bright, 16, 16)).toBe(false)
  })
})
