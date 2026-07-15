/**
 * Shared store types — kept out of the god-store file so patches, history,
 * and navigation can evolve without dragging the whole module.
 */

import type { CanvasItem, StackRecord, Viewport } from '../types/canvas'

/** Snapshot pushed onto undo / redo stacks */
export interface HistoryEntry {
  items: CanvasItem[]
  stacks: StackRecord[]
  nextZ: number
  currentContainerId: string
}

/** Screen-space folder morph for enter (expand) / exit (shrink + settle) */
export interface StackEnterAnim {
  stackId: string
  /** enter: folder→screen; exit: screen→folder then settle onto real chrome */
  mode: 'enter' | 'exit'
  /** Screen-space rect at t=0 */
  start: { x: number; y: number; w: number; h: number }
  /** Screen-space rect at t=1 (defaults to fullscreen for enter) */
  end?: { x: number; y: number; w: number; h: number }
  /** 0..1 morph progress */
  t: number
  /**
   * Exit only: after morph, crossfade overlay → real StackFolder (0..1).
   * Real folder fades in while overlay fades out — no pop-in.
   */
  settle?: number
  /**
   * Parent-canvas peer visibility (0 = hidden, 1 = full).
   * Exit: 0 → 1 (fade in, starts ~200ms after exit begins).
   * Enter: 1 → 0 (fade out, reverse of exit appear curve).
   */
  peerReveal?: number
  /**
   * Nested child-stack folder chrome opacity while entering/exiting this stack.
   * Exit: 1 → 0 (B folder dissolves into the fan). Enter: 0 → 1 (B reappears).
   */
  nestedChromeOpacity?: number
  /**
   * Enter only: nested-stack leaf cards animating on the parent stack canvas
   * (fan → free pose inside nested folder) while nested chrome fades in.
   */
  nestedLeafAnims?: Array<{
    id: string
    start: { x: number; y: number; rotation: number }
    end: { x: number; y: number; rotation: number }
    width: number
    height: number
    zIndex: number
  }>
  /** Folder tab label (empty = compact tab) */
  name?: string
  /** Count badge on folder */
  memberCount?: number
  /**
   * Exit only: container the path should show during the exit anim
   * (parent/home). Breadcrumb switches immediately; canvas handoff stays later.
   */
  targetContainerId?: string
}

/**
 * Options for item patch APIs (`updateItem` / `updateItems`).
 *
 * Architectural split: document mutations are explicit about history + dirty
 * so automatic metadata (link previews) cannot silently dirty a clean board,
 * while user edits can opt into a single undo snapshot.
 */
export interface ItemPatchOptions {
  /**
   * Mark the board dirty. Default `true`.
   * Set `false` for automatic / non-user patches (OG preview, image proxy).
   */
  dirty?: boolean
  /**
   * Push an undo snapshot before applying the patch. Default `false`.
   * Prefer once-per-gesture via `useHistoryOnce` for continuous controls.
   */
  history?: boolean
}

/** Viewport + home pair used when switching containers */
export type ViewportPair = {
  viewport: Viewport
  homeViewport?: Viewport
}
