import { describe, expect, it } from 'vitest'
import { SaveQueue } from '../saveQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('SaveQueue', () => {
  it('never overlaps workers and coalesces a burst into one follow-up', async () => {
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    const calls: boolean[] = []
    let active = 0
    let maxActive = 0

    const queue = new SaveQueue(async (options) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      calls.push(options.saveAs === true)
      const result = await (calls.length === 1 ? first.promise : second.promise)
      active -= 1
      return result
    })

    const a = queue.enqueue()
    const b = queue.enqueue()
    const c = queue.enqueue({ saveAs: true })
    expect(calls).toEqual([false])

    first.resolve(true)
    await a
    expect(calls).toEqual([false, true])
    expect(maxActive).toBe(1)

    second.resolve(false)
    await expect(Promise.all([b, c])).resolves.toEqual([false, false])
    await queue.waitForIdle()
    expect(maxActive).toBe(1)
  })

  it('waitForIdle includes a follow-up queued during the active save', async () => {
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    let calls = 0
    const queue = new SaveQueue(async () => {
      calls += 1
      return calls === 1 ? first.promise : second.promise
    })

    const a = queue.enqueue()
    const idle = queue.waitForIdle()
    const b = queue.enqueue()
    let idleResolved = false
    void idle.then(() => {
      idleResolved = true
    })

    first.resolve(true)
    await a
    await Promise.resolve()
    expect(idleResolved).toBe(false)

    second.resolve(true)
    await b
    await idle
    expect(idleResolved).toBe(true)
  })
})
