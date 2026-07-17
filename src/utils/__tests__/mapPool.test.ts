import { describe, expect, it } from 'vitest'
import { mapPool } from '../mapPool'

describe('mapPool', () => {
  it('preserves order with concurrency limit', async () => {
    const active = { n: 0, max: 0 }
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (v) => {
      active.n++
      active.max = Math.max(active.max, active.n)
      await new Promise((r) => setTimeout(r, 5))
      active.n--
      return v * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
    expect(active.max).toBeLessThanOrEqual(2)
  })

  it('returns empty for empty input', async () => {
    expect(await mapPool([], 4, async (x) => x)).toEqual([])
  })
})
