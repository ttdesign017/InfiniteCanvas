import { describe, expect, it } from 'vitest'
import { shouldPaintCullRect } from '../viewportPaintCulling'

describe('viewport paint culling', () => {
  it('keeps cards inside the viewport margin paintable', () => {
    expect(
      shouldPaintCullRect(
        { left: -600, top: 100, right: -400, bottom: 300 },
        1200,
        800,
        720,
      ),
    ).toBe(false)
  })

  it('culls cards only after they are well outside the margin', () => {
    expect(
      shouldPaintCullRect(
        { left: -1000, top: 100, right: -800, bottom: 300 },
        1200,
        800,
        720,
      ),
    ).toBe(true)
    expect(
      shouldPaintCullRect(
        { left: 2000, top: 100, right: 2200, bottom: 300 },
        1200,
        800,
        720,
      ),
    ).toBe(true)
  })
})
