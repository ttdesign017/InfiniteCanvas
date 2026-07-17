/**
 * Per-frame stack enter/exit morph progress — outside the main Zustand store
 * so RAF ticks do not force a full canvas React commit every frame.
 *
 * Static anim metadata (stackId, mode, start/end rects, name) stays in
 * `stackEnterAnim`. Only scalar progress lives here.
 */

import { useSyncExternalStore } from 'react'

export type StackAnimProgress = {
  /** 0..1 morph progress */
  t: number
  /** Exit settle crossfade 0..1 */
  settle: number
  /** Parent-peer visibility 0..1 */
  peerReveal: number
  /** Nested child folder chrome 0..1 */
  nestedChromeOpacity: number
}

const DEFAULT: StackAnimProgress = {
  t: 0,
  settle: 0,
  peerReveal: 1,
  nestedChromeOpacity: 1,
}

let state: StackAnimProgress = { ...DEFAULT }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function getStackAnimProgress(): StackAnimProgress {
  return state
}

export function setStackAnimProgress(patch: Partial<StackAnimProgress>): void {
  const next: StackAnimProgress = {
    t: patch.t ?? state.t,
    settle: patch.settle ?? state.settle,
    peerReveal: patch.peerReveal ?? state.peerReveal,
    nestedChromeOpacity: patch.nestedChromeOpacity ?? state.nestedChromeOpacity,
  }
  if (
    next.t === state.t &&
    next.settle === state.settle &&
    next.peerReveal === state.peerReveal &&
    next.nestedChromeOpacity === state.nestedChromeOpacity
  ) {
    return
  }
  state = next
  emit()
}

/** Seed progress when a new stackEnterAnim session starts. */
export function seedStackAnimProgress(seed: Partial<StackAnimProgress>): void {
  state = {
    t: seed.t ?? 0,
    settle: seed.settle ?? 0,
    peerReveal: seed.peerReveal ?? 1,
    nestedChromeOpacity: seed.nestedChromeOpacity ?? 1,
  }
  emit()
}

export function resetStackAnimProgress(): void {
  state = { ...DEFAULT }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Subscribe a React component to morph progress (cheap re-renders). */
export function useStackAnimProgress(): StackAnimProgress {
  return useSyncExternalStore(subscribe, getStackAnimProgress, getStackAnimProgress)
}
