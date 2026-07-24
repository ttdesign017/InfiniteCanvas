// @vitest-environment happy-dom

import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoFocusEdit } from '../useAutoFocusEdit'

function Probe({
  active,
  onEnd,
}: {
  active: boolean
  onEnd: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const { onBlur } = useAutoFocusEdit(active, ref, onEnd)
  return createElement('textarea', {
    ref,
    onBlur,
    'data-testid': 'edit',
  })
}

describe('useAutoFocusEdit', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.useRealTimers()
  })

  it('focuses the field when active becomes true', async () => {
    const onEnd = vi.fn()
    await act(async () => {
      root.render(createElement(Probe, { active: true, onEnd }))
    })
    await act(async () => {
      vi.runAllTimers()
    })
    const el = host.querySelector('textarea')
    expect(el).toBeTruthy()
    expect(document.activeElement).toBe(el)
  })

  it('ignores blur during the arm window and ends edit after', async () => {
    const onEnd = vi.fn()
    await act(async () => {
      root.render(createElement(Probe, { active: true, onEnd }))
    })
    const el = host.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      el.focus()
      el.blur()
    })
    // Still armed — should not end edit yet
    expect(onEnd).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(300)
      el.blur()
    })
    expect(onEnd).toHaveBeenCalled()
  })
})
