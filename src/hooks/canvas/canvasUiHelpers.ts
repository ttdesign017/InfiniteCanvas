import { useCanvasStore } from '../../store/useCanvasStore'

/** Blur toolbar / chrome inputs without killing in-canvas text editors. */
export function blurChrome(): void {
  const ae = document.activeElement as HTMLElement | null
  if (
    ae &&
    ae !== document.body &&
    (ae.tagName === 'INPUT' ||
      ae.tagName === 'SELECT' ||
      ae.tagName === 'BUTTON' ||
      ae.tagName === 'TEXTAREA')
  ) {
    if (ae.tagName === 'TEXTAREA' && ae.closest('.canvas-item')) return
    ae.blur()
  }
}

/**
 * True while stack enter/exit, layout fan, or any store-driven pose anim runs.
 * Interaction must not start during this — aborting anims mid-flight freezes
 * items at intermediate poses.
 */
export function isInteractionLocked(): boolean {
  const s = useCanvasStore.getState()
  return !!(s.animating || s.stackEnterAnim)
}

/** Commit or dismiss the stack name field if open. */
export function dismissStackNameEdit(): void {
  const store = useCanvasStore.getState()
  if (!store.editingStackGroupId) return
  const ae = document.activeElement as HTMLInputElement | null
  if (ae?.classList?.contains('stack-folder-name-input')) {
    store.commitStackName(store.editingStackGroupId, ae.value)
  } else {
    useCanvasStore.setState({ editingStackGroupId: null })
  }
}
