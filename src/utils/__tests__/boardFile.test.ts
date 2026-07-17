import { afterEach, describe, expect, it } from 'vitest'
import { revokeAllTrackedBlobUrls } from '../blobUrls'
import {
  assertICanvasIntegrity,
  dataUrlToBlob,
  dataUrlToObjectUrl,
  ICANVAS_FORMAT,
  ICANVAS_FORMAT_VERSION,
  ICANVAS_MAGIC,
  isPlayableMediaSrc,
  materializeRuntimeMediaSources,
  parseICanvasFile,
  serializeICanvas,
  type ICanvasDocument,
} from '../boardFile'

const project = (): ICanvasDocument => ({
  magic: ICANVAS_MAGIC,
  format: ICANVAS_FORMAT,
  formatVersion: ICANVAS_FORMAT_VERSION,
  name: 'Reference board',
  viewport: { x: 120, y: 80, zoom: 1.25 },
  nextZ: 2,
  stacks: [],
  items: [
    {
      id: 'image-1',
      type: 'image',
      x: 10,
      y: 20,
      width: 320,
      height: 180,
      rotation: 0,
      zIndex: 1,
      src: 'icanvas-asset://image-1',
      fileName: 'reference.png',
      naturalWidth: 640,
      naturalHeight: 360,
    },
  ],
  assets: {
    'image-1': {
      mime: 'image/png',
      data: 'AQID',
      fileName: 'reference.png',
    },
  },
})

describe('.icanvas parsing and integrity', () => {
  afterEach(() => {
    revokeAllTrackedBlobUrls()
  })

  it('restores packed assets as offline data URLs', () => {
    const snapshot = parseICanvasFile(serializeICanvas(project()))
    expect(snapshot.name).toBe('Reference board')
    expect(snapshot.items[0]).toMatchObject({
      id: 'image-1',
      src: 'data:image/png;base64,AQID',
    })
  })

  it('rejects a project whose media reference has no packed asset', () => {
    const broken = project()
    broken.assets = {}
    expect(() =>
      assertICanvasIntegrity(broken, { itemCount: 1, stackCount: 0 }),
    ).toThrow(/media asset missing/)
  })

  it('migrates a legacy version-1 snapshot', () => {
    const snapshot = parseICanvasFile(
      JSON.stringify({
        version: 1,
        name: 'Legacy',
        viewport: { x: 0, y: 0, zoom: 1 },
        items: [],
        nextZ: 1,
      }),
    )
    expect(snapshot).toMatchObject({ name: 'Legacy', stacks: [], nextZ: 1 })
  })

  it('verifies and restores packed audio assets', () => {
    const audioProject: ICanvasDocument = {
      ...project(),
      items: [
        {
          id: 'audio-1',
          type: 'audio',
          x: 0,
          y: 0,
          width: 324,
          height: 84,
          rotation: 0,
          zIndex: 1,
          src: 'icanvas-asset://audio-1',
          fileName: 'reference.mp3',
        },
      ],
      assets: {
        'audio-1': { mime: 'audio/mpeg', data: 'AQID', fileName: 'reference.mp3' },
      },
    }
    expect(() =>
      assertICanvasIntegrity(audioProject, { itemCount: 1, stackCount: 0 }),
    ).not.toThrow()
    expect(parseICanvasFile(serializeICanvas(audioProject)).items[0]).toMatchObject({
      type: 'audio',
      src: 'data:audio/mpeg;base64,AQID',
    })
  })

  it('rejects invalid JSON before touching the board model', () => {
    expect(() => parseICanvasFile('{ not json')).toThrow(/invalid JSON/)
  })

  it('rejects files that are not Infinite Canvas projects', () => {
    expect(() => parseICanvasFile(JSON.stringify({ hello: 'world' }))).toThrow(
      /not an Infinite Canvas project/,
    )
  })

  it('rejects documents with a wrong magic header on integrity check', () => {
    const broken = { ...project(), magic: 'NOPE' as typeof ICANVAS_MAGIC }
    expect(() =>
      assertICanvasIntegrity(broken, { itemCount: 1, stackCount: 0 }),
    ).toThrow(/missing ICNV document header/)
  })

  it('materializes video/audio data URLs into playable blob: sources', () => {
    const doc: ICanvasDocument = {
      ...project(),
      nextZ: 4,
      items: [
        {
          id: 'vid-1',
          type: 'video',
          x: 0,
          y: 0,
          width: 320,
          height: 180,
          rotation: 0,
          zIndex: 1,
          src: 'icanvas-asset://vid-1',
          fileName: 'clip.mp4',
          naturalWidth: 320,
          naturalHeight: 180,
        },
        {
          id: 'aud-1',
          type: 'audio',
          x: 0,
          y: 200,
          width: 324,
          height: 84,
          rotation: 0,
          zIndex: 2,
          src: 'icanvas-asset://aud-1',
          fileName: 'clip.mp3',
        },
        {
          id: 'img-1',
          type: 'image',
          x: 0,
          y: 300,
          width: 100,
          height: 100,
          rotation: 0,
          zIndex: 3,
          src: 'icanvas-asset://img-1',
          fileName: 'pic.png',
          naturalWidth: 100,
          naturalHeight: 100,
        },
      ],
      assets: {
        // Tiny fake payloads — enough to build Blobs / object URLs
        'vid-1': { mime: 'video/mp4', data: 'AAAA', fileName: 'clip.mp4' },
        'aud-1': { mime: 'audio/mpeg', data: '//uQ', fileName: 'clip.mp3' },
        'img-1': { mime: 'image/png', data: 'AQID', fileName: 'pic.png' },
      },
    }

    const unpacked = parseICanvasFile(serializeICanvas(doc))
    const unpackedVideo = unpacked.items.find((i) => i.id === 'vid-1') as {
      src: string
    }
    // Intermediate form still uses data: (what the file layer produces)
    expect(unpackedVideo.src).toMatch(/^data:video\/mp4;base64,/)
    expect(isPlayableMediaSrc(unpackedVideo.src)).toBe(false)

    revokeAllTrackedBlobUrls()
    const live = materializeRuntimeMediaSources(unpacked.items)

    for (const id of ['vid-1', 'aud-1', 'img-1']) {
      const item = live.find((i) => i.id === id) as { src: string }
      expect(item).toBeDefined()
      expect(item.src).toMatch(/^blob:/)
      expect(isPlayableMediaSrc(item.src)).toBe(true)
    }
  })

  it('materializes every common canvas media type for open-board display', () => {
    const doc: ICanvasDocument = {
      ...project(),
      items: [
        {
          id: 'image',
          type: 'image',
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          rotation: 0,
          zIndex: 1,
          src: 'icanvas-asset://image',
          fileName: 'image.bin',
          naturalWidth: 100,
          naturalHeight: 80,
        },
        {
          id: 'gif',
          type: 'gif',
          x: 10,
          y: 0,
          width: 100,
          height: 80,
          rotation: 0,
          zIndex: 2,
          src: 'icanvas-asset://gif',
          fileName: 'gif.bin',
          naturalWidth: 100,
          naturalHeight: 80,
        },
        {
          id: 'video',
          type: 'video',
          x: 20,
          y: 0,
          width: 100,
          height: 80,
          rotation: 0,
          zIndex: 3,
          src: 'icanvas-asset://video',
          fileName: 'video.bin',
          naturalWidth: 100,
          naturalHeight: 80,
        },
        {
          id: 'audio',
          type: 'audio',
          x: 30,
          y: 0,
          width: 100,
          height: 84,
          rotation: 0,
          zIndex: 4,
          src: 'icanvas-asset://audio',
          fileName: 'audio.bin',
        },
      ],
      assets: {
        image: { mime: 'image/png', data: 'AQID', fileName: 'image.bin' },
        gif: { mime: 'image/gif', data: 'AQID', fileName: 'gif.bin' },
        video: { mime: 'video/mp4', data: 'AQID', fileName: 'video.bin' },
        audio: { mime: 'audio/mpeg', data: 'AQID', fileName: 'audio.bin' },
      },
    }

    revokeAllTrackedBlobUrls()
    const live = materializeRuntimeMediaSources(
      parseICanvasFile(serializeICanvas(doc)).items,
    )
    expect(live).toHaveLength(4)
    for (const item of live) {
      const src = (item as { src: string }).src
      expect(src.startsWith('blob:')).toBe(true)
      expect(isPlayableMediaSrc(src)).toBe(true)
    }
  })

  it('decodes data URLs into non-empty blobs', () => {
    const blob = dataUrlToBlob('data:video/mp4;base64,AAAA')
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe('video/mp4')
    expect(blob!.size).toBeGreaterThan(0)
    const url = dataUrlToObjectUrl('data:audio/mpeg;base64,AQID')
    expect(url).toMatch(/^blob:/)
  })

  it('round-trips nested stacks and container membership', () => {
    const nested: ICanvasDocument = {
      ...project(),
      nextZ: 5,
      stacks: [
        {
          id: 'stack-a',
          parentId: 'root',
          name: 'A',
          x: 0,
          y: 0,
          width: 200,
          height: 160,
          zIndex: 2,
        },
        {
          id: 'stack-b',
          parentId: 'stack-a',
          name: 'B',
          x: 20,
          y: 20,
          width: 120,
          height: 100,
          zIndex: 3,
        },
      ],
      items: [
        {
          id: 'note-root',
          type: 'text',
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          rotation: 0,
          zIndex: 1,
          containerId: 'root',
          content: 'root note',
          fontSize: 16,
          fontFamily: 'sans-serif',
          fontWeight: 400,
          color: '#111',
          backgroundColor: 'transparent',
        },
        {
          id: 'note-in-b',
          type: 'text',
          x: 8,
          y: 12,
          width: 100,
          height: 40,
          rotation: 0,
          zIndex: 4,
          containerId: 'stack-b',
          content: 'inside B',
          fontSize: 16,
          fontFamily: 'sans-serif',
          fontWeight: 400,
          color: '#111',
          backgroundColor: 'transparent',
        },
        project().items[0],
      ],
      assets: project().assets,
    }

    const text = serializeICanvas(nested)
    const snapshot = parseICanvasFile(text)

    expect(snapshot.stacks).toHaveLength(2)
    expect(snapshot.stacks?.map((s) => s.id)).toEqual(['stack-a', 'stack-b'])
    expect(snapshot.items.find((i) => i.id === 'note-in-b')).toMatchObject({
      containerId: 'stack-b',
      content: 'inside B',
    })
    expect(snapshot.items.find((i) => i.id === 'image-1')).toMatchObject({
      src: 'data:image/png;base64,AQID',
    })
    expect(() =>
      assertICanvasIntegrity(nested, { itemCount: 3, stackCount: 2 }),
    ).not.toThrow()
  })
})
