// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import { clearAllStackFanComposites } from '../../utils/stackFanComposite'
import { CollapsedStackFans } from '../CollapsedStackFans'

describe('CollapsedStackFans', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    clearAllStackFanComposites()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    clearAllStackFanComposites()
  })

  it('keeps note content visible on a collapsed stack fan', async () => {
    const stack: StackRecord = {
      id: 'stack-1',
      parentId: 'root',
      name: 'Notes',
      x: 40,
      y: 60,
      width: 280,
      height: 180,
      zIndex: 1,
    }
    const note: CanvasItem = {
      id: 'note-1',
      type: 'textcard',
      x: 56,
      y: 72,
      width: 240,
      height: 120,
      rotation: -2,
      zIndex: 2,
      containerId: stack.id,
      stacked: true,
      stackGroupId: stack.id,
      content: 'Fan note text must remain visible',
      fontSize: 14,
      color: '#6b6b6b',
      backgroundColor: '#ffffff',
      labelColor: '#8c8c8c',
      labelBackground: 'transparent',
    }

    await act(async () => {
      root.render(
        createElement(CollapsedStackFans, {
          stack,
          items: [note],
          stacks: [stack],
          fanItems: [note],
          opacity: 1,
          selected: false,
          forceLive: false,
          zIndexBase: 2,
        }),
      )
    })

    const body = host.querySelector('.notion-card-body')
    expect(body?.textContent).toBe('Fan note text must remain visible')
    expect(host.querySelector('.stack-fan-composite')).toBeNull()
  })
})
