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
  packICanvasDocument,
  parseICanvasFile,
  serializeICanvas,
  type ICanvasDocument,
} from '../boardFile'
import {
  clearPackAssetCache,
  getCachedPackAsset,
} from '../packAssetCache'

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
    clearPackAssetCache()
  })

  it('keeps packed asset refs until materialize (open-path memory)', () => {
    const snapshot = parseICanvasFile(serializeICanvas(project()))
    expect(snapshot.name).toBe('Reference board')
    expect(snapshot.items[0]).toMatchObject({
      id: 'image-1',
      src: 'icanvas-asset://image-1',
    })
    expect(snapshot.packedAssets?.['image-1']?.data).toBe('AQID')
    revokeAllTrackedBlobUrls()
    const live = materializeRuntimeMediaSources(
      snapshot.items,
      snapshot.packedAssets,
    )
    expect((live[0] as { src: string }).src).toMatch(/^blob:/)
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
    const audioSnap = parseICanvasFile(serializeICanvas(audioProject))
    expect(audioSnap.items[0]).toMatchObject({
      type: 'audio',
      src: 'icanvas-asset://audio-1',
    })
    revokeAllTrackedBlobUrls()
    const liveAudio = materializeRuntimeMediaSources(
      audioSnap.items,
      audioSnap.packedAssets,
    )
    expect((liveAudio[0] as { src: string }).src).toMatch(/^blob:/)
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
    // Packed form keeps asset refs until hydrate (after revoke of previous board)
    expect(unpackedVideo.src).toBe('icanvas-asset://vid-1')
    expect(isPlayableMediaSrc(unpackedVideo.src)).toBe(false)

    revokeAllTrackedBlobUrls()
    const live = materializeRuntimeMediaSources(
      unpacked.items,
      unpacked.packedAssets,
    )

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
    const snap = parseICanvasFile(serializeICanvas(doc))
    const live = materializeRuntimeMediaSources(snap.items, snap.packedAssets)
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

  it('caches packed media so a second pack reuses the asset', async () => {
    const src = 'data:image/png;base64,AQID'
    const snap = {
      version: 1 as const,
      name: 'Cache',
      viewport: { x: 0, y: 0, zoom: 1 },
      nextZ: 2,
      items: [
        {
          id: 'img-cache',
          type: 'image' as const,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          zIndex: 1,
          src,
          fileName: 'c.png',
          naturalWidth: 10,
          naturalHeight: 10,
        },
      ],
      stacks: [],
    }
    const first = await packICanvasDocument(snap)
    expect(first.assets['img-cache']?.data).toBeTruthy()
    expect(getCachedPackAsset(src, 'c.png')?.data).toBe(
      first.assets['img-cache'].data,
    )
    const second = await packICanvasDocument(snap)
    expect(second.assets['img-cache'].data).toBe(first.assets['img-cache'].data)
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
      src: 'icanvas-asset://image-1',
    })
    revokeAllTrackedBlobUrls()
    const liveNested = materializeRuntimeMediaSources(
      snapshot.items,
      snapshot.packedAssets,
    )
    expect(
      (liveNested.find((i) => i.id === 'image-1') as { src: string }).src,
    ).toMatch(/^blob:/)
    expect(() =>
      assertICanvasIntegrity(nested, { itemCount: 3, stackCount: 2 }),
    ).not.toThrow()
  })
})
