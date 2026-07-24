import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyMedia, createMediaItemFromSrc } from '../media'

describe('audio media import', () => {
  it.each([
    ['track.mp3', 'audio'],
    ['field.wav', 'audio'],
    ['voice.m4a', 'audio'],
    ['master.flac', 'audio'],
    ['session.ogg', 'audio'],
    ['stream.opus', 'audio'],
    ['archive.wma', 'audio'],
    ['source.aiff', 'audio'],
  ] as const)('classifies %s as %s', (fileName, expected) => {
    expect(classifyMedia(fileName)).toBe(expected)
  })

  it('uses MIME when a pasted audio file has no useful extension', () => {
    expect(classifyMedia('recording', 'audio/aac')).toBe('audio')
  })

  it('creates the stable canvas frame used by the expanding audio island', async () => {
    const item = await createMediaItemFromSrc(
      'blob:audio-test',
      'Reference.mp3',
      'audio',
      40,
      60,
      7,
    )
    expect(item).toMatchObject({
      type: 'audio',
      width: 324,
      height: 84,
      x: 40,
      y: 60,
      zIndex: 7,
    })
  })
})

describe('image/video import display size', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses original image pixel size on canvas (no unified downscale)', async () => {
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_v: string) {
          this.naturalWidth = 1920
          this.naturalHeight = 1080
          queueMicrotask(() => this.onload?.())
        }
      },
    )

    const item = await createMediaItemFromSrc(
      'blob:image-test',
      'photo.jpg',
      'image',
      10,
      20,
      1,
    )
    expect(item).toMatchObject({
      type: 'image',
      naturalWidth: 1920,
      naturalHeight: 1080,
      width: 1920,
      height: 1080,
    })
  })

  it('uses original video pixel size on canvas (no unified downscale)', async () => {
    let fired = false
    const video = {
      preload: '',
      videoWidth: 1280,
      videoHeight: 720,
      onloadedmetadata: null as (() => void) | null,
      onerror: null as (() => void) | null,
      set src(v: string) {
        if (!v || fired) return
        fired = true
        queueMicrotask(() => this.onloadedmetadata?.())
      },
    }
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'video') return video
        throw new Error(`unexpected element: ${tag}`)
      },
    })

    const item = await createMediaItemFromSrc(
      'blob:video-test',
      'clip.mp4',
      'video',
      0,
      0,
      2,
    )
    expect(item).toMatchObject({
      type: 'video',
      naturalWidth: 1280,
      naturalHeight: 720,
      width: 1280,
      height: 720,
    })
  })
})
