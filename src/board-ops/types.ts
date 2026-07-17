/**
 * board-ops input/output types (domain layer for UI + future MCP).
 */

import type { BoardSnapshot, CanvasItem, StackRecord } from '../types/canvas'
import type {
  BoardMetaDto,
  ItemDetailDto,
  ItemSummaryDto,
  StackTreeNodeDto,
  TextExportBlockDto,
} from './dto'

/** Minimal board handle used by pure ops (snapshot fields). */
export type BoardView = {
  name: string
  items: CanvasItem[]
  stacks: StackRecord[]
  viewport: BoardSnapshot['viewport']
  homeViewport?: BoardSnapshot['viewport']
  nextZ: number
  currentContainerId: string
}

export function boardViewFromSnapshot(snap: BoardSnapshot): BoardView {
  return {
    name: snap.name || 'Untitled Board',
    items: snap.items,
    stacks: snap.stacks ?? [],
    viewport: snap.viewport,
    homeViewport: snap.homeViewport,
    nextZ: snap.nextZ ?? 1,
    currentContainerId: snap.currentContainerId || 'root',
  }
}

export function snapshotFromBoardView(view: BoardView): BoardSnapshot {
  return {
    version: 1,
    name: view.name,
    items: view.items,
    stacks: view.stacks,
    viewport: view.viewport,
    homeViewport: view.homeViewport,
    nextZ: view.nextZ,
    currentContainerId: view.currentContainerId,
  }
}

/** One undo-friendly mutation result (single history point for the whole batch). */
export type BoardMutationResult = {
  board: BoardView
  /** Ids created in this call */
  createdIds: string[]
  /** Ids patched / moved */
  changedIds: string[]
  /** When true, caller must not persist (preview only). */
  dryRun: boolean
}

export type ListItemsQuery = {
  /**
   * Required for stable agent calls. Use `root` for home canvas.
   * Never inferred from UI unless live backend injects it explicitly.
   */
  containerId: string
  type?: CanvasItem['type'] | CanvasItem['type'][]
  limit?: number
  offset?: number
}

export type GetItemQuery = {
  id: string
}

export type TreeQuery = {
  /** Root of the subtree; default `root` lists home stacks. */
  containerId?: string
  /** Max stack nesting depth (0 = only direct child stacks). Default 8. */
  depth?: number
}

export type ExportTextQuery = {
  containerId: string
  /** If set, only these item ids (still filtered to container). */
  ids?: string[]
  maxCharsPerItem?: number
}

export type SearchQuery = {
  query: string
  containerId?: string
  type?: CanvasItem['type'] | CanvasItem['type'][]
  limit?: number
}

export type CreateNoteInput = {
  containerId: string
  x: number
  y: number
  content?: string
  width?: number
  height?: number
  /** `textcard` (default) or free `text` */
  kind?: 'textcard' | 'text'
  /**
   * Client-supplied id for idempotency; if an item with this id exists, no-op return.
   */
  clientRequestId?: string
}

export type UpdateTextInput = {
  id: string
  content?: string
  color?: string
  backgroundColor?: string
  fontSize?: number
  width?: number
  height?: number
}

export type MoveItemsInput = {
  /** Absolute poses; omitted axes keep previous. */
  moves: Array<{
    id: string
    x?: number
    y?: number
    rotation?: number
  }>
}

export type WriteOptions = {
  /**
   * If true, compute next board but do not signal persistence.
   * Callers still receive `board` for inspection.
   */
  dryRun?: boolean
}

export type BoardMetaResult = BoardMetaDto
export type ListItemsResult = { items: ItemSummaryDto[]; total: number }
export type TreeResult = { roots: StackTreeNodeDto[] }
export type ExportTextResult = { blocks: TextExportBlockDto[]; plainText: string }
export type SearchResult = { items: ItemSummaryDto[] }
export type GetItemResult = ItemDetailDto
