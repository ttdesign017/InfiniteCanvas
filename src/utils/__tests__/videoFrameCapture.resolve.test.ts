/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '../../types/canvas'
import {
  clearAllRememberedPlaybackTimes,
  rememberPlaybackTime,
} from '../videoPlaybackClock'

// Mock detached loader so we don't need a real decoder in unit tests
const openDetached = vi.fn()
vi.mock('../detachedVideo', () => ({
  openDetachedVideoAtTime: (...args: unknown[]) => openDetached(...args),
}))

import {
  findVideoElement,
  resolveVideoElementForSnapshot,
} from '../videoFrameCapture'

function makeVideoItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'vid-1',
    type: 'video',
    src: 'blob:fake-video',
    naturalWidth: 640,
    naturalHeight: 360,
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    rotation: 0,
    zIndex: 1,
    ...overrides,
  }
}

afterEach(() => {
  clearAllRememberedPlaybackTimes()
  openDetached.mockReset()
  document.body.innerHTML = ''
})

describe('resolveVideoElementForSnapshot', () => {
  it('prefers a ready live <video> in the DOM (playing path)', async () => {
    const live = document.createElement('video')
    live.setAttribute('data-playback-id', 'vid-1')
    Object.defineProperty(live, 'readyState', { get: () => 4 })
    Object.defineProperty(live, 'videoWidth', { get: () => 640 })
    Object.defineProperty(live, 'videoHeight', { get: () => 360 })
    document.body.appendChild(live)

    const resolved = await resolveVideoElementForSnapshot(makeVideoItem())
    expect(resolved).not.toBeNull()
    expect(resolved!.video).toBe(live)
    expect(openDetached).not.toHaveBeenCalled()
    resolved!.dispose()
  })

  it('falls back to detached video at remembered time when idle (no live el)', async () => {
    rememberPlaybackTime('vid-1', 9.5)
    const fake = document.createElement('video')
    Object.defineProperty(fake, 'readyState', { get: () => 4 })
    Object.defineProperty(fake, 'videoWidth', { get: () => 640 })
    openDetached.mockResolvedValue({
      video: fake,
      dispose: vi.fn(),
    })

    const resolved = await resolveVideoElementForSnapshot(makeVideoItem())
    expect(resolved).not.toBeNull()
    expect(openDetached).toHaveBeenCalled()
    const [src, time] = openDetached.mock.calls[0]
    expect(src).toBe('blob:fake-video')
    // preferredSnapshotTime(9.5) → 9.5
    expect(time).toBe(9.5)
    resolved!.dispose()
  })

  it('uses nudged start time when never played (Shift+C idle regression)', async () => {
    const fake = document.createElement('video')
    Object.defineProperty(fake, 'readyState', { get: () => 4 })
    Object.defineProperty(fake, 'videoWidth', { get: () => 640 })
    openDetached.mockResolvedValue({
      video: fake,
      dispose: vi.fn(),
    })

    await resolveVideoElementForSnapshot(makeVideoItem())
    expect(openDetached).toHaveBeenCalled()
    const [, time] = openDetached.mock.calls[0]
    // No remembered time → preferredSnapshotTime(0) without duration → 0
    // (detached loader may still play/pause to paint a frame)
    expect(typeof time).toBe('number')
    expect(time).toBeGreaterThanOrEqual(0)
  })

  it('returns null for non-video items', async () => {
    const item = makeVideoItem({ type: 'image' as 'video' })
    // Force type for test of early return — cast through unknown
    const bad = { ...item, type: 'image' } as unknown as MediaItem
    expect(await resolveVideoElementForSnapshot(bad)).toBeNull()
    expect(openDetached).not.toHaveBeenCalled()
  })
})

describe('findVideoElement', () => {
  it('finds by data-playback-id', () => {
    const el = document.createElement('video')
    el.setAttribute('data-playback-id', 'abc')
    document.body.appendChild(el)
    expect(findVideoElement('abc')).toBe(el)
    expect(findVideoElement('nope')).toBeNull()
  })
})
