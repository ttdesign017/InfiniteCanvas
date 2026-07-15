import { describe, expect, it } from 'vitest'
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
