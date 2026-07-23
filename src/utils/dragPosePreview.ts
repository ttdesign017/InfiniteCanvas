/**
 * Multi-item drag visuals — same performance model as pan/zoom.
 *
 * Pan only mutates one CSS transform on `.canvas-world` (no item React commits).
 * Multi-drag previously emitted every frame → 35× CanvasItemView re-renders (lag).
 *
 * Now:
 * - begin/end: one React notify so members get `.is-drag-member` and use CSS vars
 * - each pointer frame: only set `--drag-dx` / `--drag-dy` on the host element
 * - pointer-up: commit store once, then end
 */

export type DragPoseState = {
  dx: number
  dy: number
  itemIds: ReadonlySet<string>
  stackIds: ReadonlySet<string>
}

let hostEl: HTMLElement | null = null
let itemIds: Set<string> | null = null
let stackIds: Set<string> | null = null
let dx = 0
let dy = 0
let version = 0
const listeners = new Set<() => void>()

function emit() {
  version += 1
  for (const l of listeners) l()
}

function applyHostCss() {
  if (!hostEl) return
  hostEl.style.setProperty('--drag-dx', `${dx}px`)
  hostEl.style.setProperty('--drag-dy', `${dy}px`)
}

function clearHostCss() {
  if (!hostEl) return
  hostEl.style.setProperty('--drag-dx', '0px')
  hostEl.style.setProperty('--drag-dy', '0px')
}

/** Bind the canvas-world (or any) host that owns --drag-dx / --drag-dy. */
export function bindDragPoseHost(el: HTMLElement | null): void {
  hostEl = el
  if (itemIds) applyHostCss()
  else clearHostCss()
}

export function getDragPoseVersion(): number {
  return version
}

export function isDragPoseActive(): boolean {
  return itemIds != null
}

export function isDragPoseMemberItem(id: string): boolean {
  return itemIds?.has(id) === true
}

export function isDragPoseMemberStack(id: string): boolean {
  return stackIds?.has(id) === true
}

/** Snapshot for commit / tests */
export function getDragPoseState(): DragPoseState | null {
  if (!itemIds) return null
  return {
    dx,
    dy,
    itemIds,
    stackIds: stackIds ?? new Set(),
  }
}

export function getDragPoseDelta(): { dx: number; dy: number } | null {
  if (!itemIds) return null
  return { dx, dy }
}

/**
 * Start a drag session (once). Notifies React so members opt into CSS vars.
 * Subsequent frames must call {@link updateDragPoseDelta} only.
 */
export function beginDragPose(
  nextItemIds: Iterable<string>,
  nextStackIds: Iterable<string> = [],
): void {
  itemIds = nextItemIds instanceof Set ? nextItemIds : new Set(nextItemIds)
  stackIds = nextStackIds instanceof Set ? nextStackIds : new Set(nextStackIds)
  dx = 0
  dy = 0
  applyHostCss()
  emit()
}

/**
 * Hot path — pure DOM CSS variables, **no** React notify.
 * This is what makes multi-drag as cheap as pan.
 */
export function updateDragPoseDelta(nextDx: number, nextDy: number): void {
  if (!itemIds) return
  if (dx === nextDx && dy === nextDy) return
  dx = nextDx
  dy = nextDy
  applyHostCss()
}

/**
 * @deprecated Prefer beginDragPose + updateDragPoseDelta.
 * Kept for tests / simple callers: begin if needed, then update delta.
 */
export function setDragPosePreview(
  nextDx: number,
  nextDy: number,
  nextItemIds: Iterable<string>,
  nextStackIds: Iterable<string> = [],
): void {
  const items = nextItemIds instanceof Set ? nextItemIds : new Set(nextItemIds)
  const stacks =
    nextStackIds instanceof Set ? nextStackIds : new Set(nextStackIds)
  if (!itemIds) {
    beginDragPose(items, stacks)
    updateDragPoseDelta(nextDx, nextDy)
    return
  }
  // Membership change mid-drag (rare alt-duplicate): re-begin
  if (!setEq(itemIds, items) || !setEq(stackIds ?? new Set(), stacks)) {
    itemIds = items
    stackIds = stacks
    emit()
  }
  updateDragPoseDelta(nextDx, nextDy)
}

export function clearDragPosePreview(): void {
  if (!itemIds && dx === 0 && dy === 0) return
  itemIds = null
  stackIds = null
  dx = 0
  dy = 0
  clearHostCss()
  emit()
}

export function subscribeDragPose(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** @deprecated use isDragPoseMemberItem */
export function getDragPoseOffsetForItem(id: string): { dx: number; dy: number } | null {
  if (!isDragPoseMemberItem(id)) return null
  return { dx, dy }
}

/** @deprecated use isDragPoseMemberStack */
export function getDragPoseOffsetForStack(id: string): { dx: number; dy: number } | null {
  if (!isDragPoseMemberStack(id)) return null
  return { dx, dy }
}

function setEq(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const x of a) {
    if (!b.has(x)) return false
  }
  return true
}
