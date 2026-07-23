// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '../../types/canvas'
import {
  clearVideoPosterCache,
} from '../../utils/videoPosterCache'
import { togglePlayback } from '../../utils/videoRegistry'
import { MediaItemView } from '../items/MediaItemView'

describe('MediaItemView video still fallback', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    clearVideoPosterCache()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    clearVideoPosterCache()
    vi.restoreAllMocks()
  })

  it('mounts the real decoder for a newly imported selected video without a poster', async () => {
    const video: MediaItem = {
      id: 'video-new',
      type: 'video',
      src: 'blob:new-video',
      fileName: 'new-video.mp4',
      naturalWidth: 1920,
      naturalHeight: 1080,
      x: 20,
      y: 30,
      width: 480,
      height: 270,
      rotation: 0,
      zIndex: 1,
    }

    await act(async () => {
      root.render(
        createElement(MediaItemView, {
          item: video,
          selected: true,
        }),
      )
    })

    expect(host.querySelector('video[data-playback-id="video-new"]')).not.toBeNull()
    expect(host.querySelector('.video-lazy-poster')).toBeNull()
    expect(host.querySelector('.video-media-fallback')).toBeNull()
  })

  it('starts poster priming when import selection arrives after the item mounts', async () => {
    const video: MediaItem = {
      id: 'video-late-selection',
      type: 'video',
      src: 'blob:late-selection',
      fileName: 'late-selection.mp4',
      naturalWidth: 1920,
      naturalHeight: 1080,
      x: 20,
      y: 30,
      width: 480,
      height: 270,
      rotation: 0,
      zIndex: 1,
    }

    await act(async () => {
      root.render(
        createElement(MediaItemView, {
          item: video,
          selected: false,
        }),
      )
    })
    expect(
      host.querySelector('video[data-playback-id="video-late-selection"]'),
    ).toBeNull()

    await act(async () => {
      root.render(
        createElement(MediaItemView, {
          item: video,
          selected: true,
        }),
      )
    })

    expect(
      host.querySelector('video[data-playback-id="video-late-selection"]'),
    ).not.toBeNull()
  })

  it('keeps the paused decoder visible after deselection when frame capture fails', async () => {
    const video: MediaItem = {
      id: 'video-pause-capture-fails',
      type: 'video',
      src: 'blob:pause-capture-fails',
      fileName: 'pause-capture-fails.mp4',
      naturalWidth: 1920,
      naturalHeight: 1080,
      x: 20,
      y: 30,
      width: 480,
      height: 270,
      rotation: 0,
      zIndex: 1,
    }
    const paused = new WeakMap<HTMLMediaElement, boolean>()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      paused.set(this, false)
      Object.defineProperty(this, 'paused', {
        configurable: true,
        get: () => paused.get(this) ?? true,
      })
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      paused.set(this, true)
      this.dispatchEvent(new Event('pause'))
    })

    await act(async () => {
      root.render(
        createElement(MediaItemView, {
          item: video,
          selected: true,
        }),
      )
    })
    expect(host.querySelector('video')).not.toBeNull()

    await act(async () => {
      togglePlayback(video.id)
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(host.querySelector('video')).not.toBeNull()

    await act(async () => {
      togglePlayback(video.id)
      // happy-dom has no decoded pixels, so poster capture resolves null via
      // the paused-frame timeout path.
      await new Promise((resolve) => setTimeout(resolve, 220))
    })

    expect(
      host.querySelector('video[data-playback-id="video-pause-capture-fails"]'),
    ).not.toBeNull()

    await act(async () => {
      root.render(
        createElement(MediaItemView, {
          item: video,
          selected: false,
        }),
      )
    })

    expect(
      host.querySelector('video[data-playback-id="video-pause-capture-fails"]'),
    ).not.toBeNull()
  })
})
