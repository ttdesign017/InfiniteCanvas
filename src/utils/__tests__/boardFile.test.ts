import { describe, expect, it } from 'vitest'
import {
  assertICanvasIntegrity,
  ICANVAS_FORMAT,
  ICANVAS_FORMAT_VERSION,
  ICANVAS_MAGIC,
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
})
