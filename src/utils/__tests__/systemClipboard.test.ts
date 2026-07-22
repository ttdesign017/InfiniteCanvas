import { describe, expect, it } from 'vitest'
import { textContentForClipboard } from '../systemClipboard'
import type { TextCardItem, TextItem } from '../../types/canvas'

function text(partial: Partial<TextItem> & { content: string }): TextItem {
  return {
    id: 't1',
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    zIndex: 1,
    fontSize: 16,
    fontFamily: 'sans-serif',
    fontWeight: 400,
    color: '#000',
    backgroundColor: 'transparent',
    ...partial,
  }
}

function note(partial: Partial<TextCardItem> & { content: string }): TextCardItem {
  return {
    id: 'n1',
    type: 'textcard',
    x: 0,
    y: 0,
    width: 240,
    height: 180,
    rotation: 0,
    zIndex: 1,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#fff',
    ...partial,
  }
}

describe('textContentForClipboard', () => {
  it('returns free text content', () => {
    expect(textContentForClipboard(text({ content: 'Hello' }))).toBe('Hello')
  })

  it('returns note content', () => {
    expect(textContentForClipboard(note({ content: 'Meeting notes' }))).toBe(
      'Meeting notes',
    )
  })

  it('skips empty and placeholder notes', () => {
    expect(textContentForClipboard(note({ content: '' }))).toBeNull()
    expect(textContentForClipboard(note({ content: '   ' }))).toBeNull()
    expect(textContentForClipboard(note({ content: 'Write a note…' }))).toBeNull()
    expect(textContentForClipboard(note({ content: 'Write a note...' }))).toBeNull()
  })

  it('preserves internal whitespace of real content', () => {
    expect(textContentForClipboard(text({ content: 'line1\nline2' }))).toBe(
      'line1\nline2',
    )
  })
})
