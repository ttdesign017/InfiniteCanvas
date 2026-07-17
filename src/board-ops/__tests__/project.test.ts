import { describe, expect, it } from 'vitest'
import type { CanvasItem } from '../../types/canvas'
import { toItemSummary } from '../project'

describe('board-ops project', () => {
  it('never puts media src into summary JSON', () => {
    const item: CanvasItem = {
      id: 'v1',
      type: 'video',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      rotation: 0,
      zIndex: 1,
      src: 'data:video/mp4;base64,AAAAVERYLONG',
      fileName: 'clip.mp4',
      naturalWidth: 100,
      naturalHeight: 80,
    }
    const s = toItemSummary(item)
    expect(s.media?.srcKind).toBe('data')
    expect(JSON.stringify(s)).not.toContain('AAAAVERYLONG')
    expect(JSON.stringify(s)).not.toContain('base64')
  })
})
