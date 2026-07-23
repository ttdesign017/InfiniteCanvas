/**
 * Snap guide lines outside React parent state.
 *
 * Updating guides via useState in the canvas controller re-rendered the entire
 * InfiniteCanvas tree every frame. Multi-select drag skipped guides for N>4
 * to avoid that cost — so alignment worked but lines vanished.
 *
 * Now only SnapGuidesLayer re-renders when guides change.
 */

import type { SnapGuide } from './snap'
import { guidesEqual } from './snap'

let guides: SnapGuide[] = []
let version = 0
const listeners = new Set<() => void>()

function emit() {
  version += 1
  for (const l of listeners) l()
}

export function getSnapGuidesVersion(): number {
  return version
}

export function getSnapGuides(): SnapGuide[] {
  return guides
}

export function setSnapGuidesBus(next: SnapGuide[]): void {
  if (guidesEqual(guides, next)) return
  guides = next
  emit()
}

export function clearSnapGuidesBus(): void {
  if (guides.length === 0) return
  guides = []
  emit()
}

export function subscribeSnapGuides(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
