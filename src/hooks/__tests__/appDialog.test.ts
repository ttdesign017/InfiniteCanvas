import { describe, expect, it, beforeEach } from 'vitest'
import {
  answerAppDialog,
  getAppDialogSnapshot,
  showAppDialog,
  subscribeAppDialog,
} from '../appDialog'

describe('appDialog snapshot stability', () => {
  beforeEach(() => {
    // Close any leftover open dialog
    const s = getAppDialogSnapshot()
    if (s.open) answerAppDialog(s.cancelId ?? s.defaultId)
  })

  it('getAppDialogSnapshot returns the same reference when idle', () => {
    const a = getAppDialogSnapshot()
    const b = getAppDialogSnapshot()
    expect(a).toBe(b)
    expect(a.open).toBe(false)
  })

  it('changes snapshot reference only when opened / answered', async () => {
    const before = getAppDialogSnapshot()
    let notifies = 0
    const unsub = subscribeAppDialog(() => {
      notifies += 1
    })

    const pending = showAppDialog({
      title: 'T',
      body: 'B',
      buttons: [{ id: 'ok', label: 'OK', variant: 'primary' }],
    })
    const openSnap = getAppDialogSnapshot()
    expect(openSnap).not.toBe(before)
    expect(openSnap.open).toBe(true)
    expect(notifies).toBe(1)

    // Still stable while open
    expect(getAppDialogSnapshot()).toBe(openSnap)

    answerAppDialog('ok')
    await pending
    const after = getAppDialogSnapshot()
    expect(after).not.toBe(openSnap)
    expect(after.open).toBe(false)
    expect(notifies).toBe(2)
    expect(getAppDialogSnapshot()).toBe(after)

    unsub()
  })
})
