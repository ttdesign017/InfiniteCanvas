import { useCanvasStore } from '../../store/useCanvasStore'

const transformReleaseTimers = new WeakMap<HTMLElement, number>()
const activePanWorlds = new WeakSet<HTMLElement>()
const TRANSFORM_WARM_HOLD_MS = 260

function canvasWorld(
  surface: HTMLElement | null | undefined,
): HTMLElement | null {
  return (surface?.querySelector('.canvas-world') as HTMLElement | null) ?? null
}

function clearTransformRelease(world: HTMLElement) {
  const timer = transformReleaseTimers.get(world)
  if (timer != null) {
    window.clearTimeout(timer)
    transformReleaseTimers.delete(world)
  }
}

function releaseTransformLater(
  world: HTMLElement,
  delayMs = TRANSFORM_WARM_HOLD_MS,
) {
  clearTransformRelease(world)
  const timer = window.setTimeout(() => {
    transformReleaseTimers.delete(world)
    if (!activePanWorlds.has(world)) {
      world.style.willChange = 'auto'
    }
  }, delayMs)
  transformReleaseTimers.set(world, timer)
}

/**
 * Warm the single world transform layer for a wheel gesture, then retain it
 * briefly so trackpad/wheel bursts do not repeatedly promote and demote a
 * media-heavy canvas.
 */
export function prewarmCanvasTransform(
  surface: HTMLElement | null | undefined,
) {
  const world = canvasWorld(surface)
  if (!world) return
  clearTransformRelease(world)
  world.style.willChange = 'transform'
  if (!activePanWorlds.has(world)) releaseTransformLater(world)
}

/** Pan grab chrome without React re-render of the item tree. */
export function setPanChrome(surface: HTMLElement | null | undefined, on: boolean) {
  if (!surface) {
    surface = document.querySelector('.canvas-surface') as HTMLElement | null
  }
  if (!surface) return
  surface.classList.toggle('is-panning', on)
  const world = canvasWorld(surface)
  if (on) {
    surface.style.cursor = 'grabbing'
    if (world) {
      clearTransformRelease(world)
      activePanWorlds.add(world)
      world.style.willChange = 'transform'
    }
  } else {
    surface.style.removeProperty('cursor')
    if (world) {
      activePanWorlds.delete(world)
      releaseTransformLater(world)
    }
  }
}

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
