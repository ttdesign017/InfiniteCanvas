import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../../store/useCanvasStore'
import {
  applyModalTransform,
  beginModalTransform,
  type ModalTransformSession,
} from '../../utils/modalTransform'
import type { SnapGuide } from '../../utils/snap'

/**
 * Blender-style G / R / S modal transform: global hotkeys + pointer while active.
 * Returns refs/state the main controller needs for UI and to block conflicting tools.
 */
export function useModalTransformHotkeys(options: {
  setSnapGuides: (guides: SnapGuide[]) => void
}) {
  const { setSnapGuides } = options
  const modalXformRef = useRef<ModalTransformSession | null>(null)
  const [modalXformKind, setModalXformKind] = useState<string | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      if (!t || !(t instanceof HTMLElement)) return false
      if (t.isContentEditable) return true
      const tag = t.tagName
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (tag === 'INPUT') {
        const type = ((t as HTMLInputElement).type || 'text').toLowerCase()
        return !(
          type === 'color' ||
          type === 'range' ||
          type === 'checkbox' ||
          type === 'radio' ||
          type === 'button' ||
          type === 'submit'
        )
      }
      return false
    }

    const cancelModal = () => {
      const session = modalXformRef.current
      if (!session) return
      useCanvasStore.setState({
        items: session.cancelItems,
        stacks: session.cancelStacks,
      })
      modalXformRef.current = null
      setModalXformKind(null)
      setSnapGuides([])
    }

    const confirmModal = () => {
      if (!modalXformRef.current) return
      modalXformRef.current = null
      setModalXformKind(null)
      setSnapGuides([])
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const store = useCanvasStore.getState()
      if (store.animating) return

      if (modalXformRef.current) {
        if (e.key === 'Escape' || e.code === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          cancelModal()
          return
        }
        if (e.key === 'Enter' || e.code === 'Enter') {
          e.preventDefault()
          confirmModal()
          return
        }
        return
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== 'g' && key !== 'r' && key !== 's') return
      if (store.selectedIds.length === 0 && store.selectedStackIds.length === 0)
        return

      const kind = key === 'g' ? 'grab' : key === 'r' ? 'rotate' : 'scale'
      const cx = lastPointerRef.current?.x ?? window.innerWidth / 2
      const cy = lastPointerRef.current?.y ?? window.innerHeight / 2
      const session = beginModalTransform(
        kind,
        store.items,
        store.stacks,
        store.selectedIds,
        store.selectedStackIds,
        cx,
        cy,
        store.viewport,
      )
      if (!session) return
      e.preventDefault()
      e.stopPropagation()
      store.pushHistory()
      session.cancelItems = useCanvasStore
        .getState()
        .items.map((i) => ({ ...i }))
      session.cancelStacks = useCanvasStore
        .getState()
        .stacks.map((s) => ({ ...s }))
      modalXformRef.current = session
      setModalXformKind(kind)
    }

    const onPointerMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      const session = modalXformRef.current
      if (!session) return
      const store = useCanvasStore.getState()
      const { itemPatches, stackPatches, guides } = applyModalTransform(
        session,
        e.clientX,
        e.clientY,
        store.viewport,
        {
          snapEnabled: session.kind === 'grab' && store.snapEnabled,
          angleSnap: session.kind === 'rotate' && e.shiftKey,
          allItems: store.items,
          allStacks: store.stacks,
          containerId: store.currentContainerId,
        },
      )
      if (itemPatches.length) store.updateItems(itemPatches)
      if (stackPatches.length) store.updateStacks(stackPatches)
      setSnapGuides(session.kind === 'rotate' ? [] : guides)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!modalXformRef.current) return
      if (e.button === 0) {
        e.preventDefault()
        e.stopPropagation()
        confirmModal()
      } else if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
        cancelModal()
      }
    }

    const onContextMenu = (e: Event) => {
      if (modalXformRef.current) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [setSnapGuides])

  return { modalXformRef, modalXformKind, lastPointerRef }
}
