/**
 * Write-result envelope + read-after-write verification for agent/MCP.
 */

import type { BoardView } from './types'
import type { BoardMutationResult } from './types'
import { getBoardMeta } from './read'
import { BoardOpsError } from './errors'
import { containerOf } from '../utils/stacks'
import { ROOT_CONTAINER_ID } from '../types/canvas'

export type PersistState = 'live' | 'memory' | 'disk'

export type WriteResultEnvelope = {
  ok: true
  /** Item ids created (never stack ids) */
  createdIds: string[]
  /** Stack folder ids created */
  createdStackIds: string[]
  changedIds: string[]
  /** Ids confirmed present after write */
  verified: {
    items: string[]
    stacks: string[]
  }
  /** Monotonic board revision after this write (0 if unknown) */
  revision: number
  /**
   * live  = applied to open Infinite Canvas window
   * memory = file-session RAM only (needs ic2_board_save)
   * disk   = written to .icanvas path
   */
  persisted: PersistState
  /** True when live window has the objects now */
  visibleInLiveBoard: boolean
  /**
   * Board has unsaved user-visible changes (live or file session).
   * Live: app dirty flag. File: session dirty until ic2_board_save.
   */
  dirty: boolean
  /** Live board needs user Ctrl+S (or app auto-save later) */
  pendingUserSave: boolean
  /** True only after a successful ic2_board_save in this session */
  autoSaved: boolean
  dryRun: boolean
  stackId?: string
  itemIds?: string[]
  warnings?: string[]
  meta?: ReturnType<typeof getBoardMeta>
}

export function nextRevision(board: BoardView): number {
  const r = (board as BoardView & { revision?: number }).revision
  return typeof r === 'number' && r >= 0 ? r + 1 : 1
}

export function withRevision(board: BoardView, revision: number): BoardView {
  return { ...board, revision } as BoardView & { revision: number }
}

export function verifyBoardHas(
  board: BoardView,
  opts: { itemIds?: string[]; stackIds?: string[] },
): { items: string[]; stacks: string[]; missingItems: string[]; missingStacks: string[] } {
  const itemSet = new Set(board.items.map((i) => i.id))
  const stackSet = new Set(board.stacks.map((s) => s.id))
  const itemIds = opts.itemIds ?? []
  const stackIds = opts.stackIds ?? []
  const missingItems = itemIds.filter((id) => !itemSet.has(id))
  const missingStacks = stackIds.filter((id) => !stackSet.has(id))
  return {
    items: itemIds.filter((id) => itemSet.has(id)),
    stacks: stackIds.filter((id) => stackSet.has(id)),
    missingItems,
    missingStacks,
  }
}

/**
 * Split mutation.createdIds into items vs stacks (legacy callers put both in createdIds).
 */
export function partitionCreatedIds(
  board: BoardView,
  createdIds: string[],
  explicitStackIds?: string[],
): { createdIds: string[]; createdStackIds: string[] } {
  const itemSet = new Set(board.items.map((i) => i.id))
  const stackSet = new Set(board.stacks.map((s) => s.id))
  const createdStackIds = [
    ...new Set([
      ...(explicitStackIds ?? []),
      ...createdIds.filter((id) => stackSet.has(id) && !itemSet.has(id)),
    ]),
  ]
  const itemOnly = createdIds.filter((id) => itemSet.has(id))
  return { createdIds: itemOnly, createdStackIds }
}

export function buildWriteEnvelope(
  board: BoardView,
  m: BoardMutationResult & {
    stackId?: string
    itemIds?: string[]
    createdStackIds?: string[]
    warnings?: string[]
  },
  opts: {
    persisted: PersistState
    visibleInLiveBoard: boolean
    dirty: boolean
    pendingUserSave: boolean
    autoSaved?: boolean
    revision: number
  },
): WriteResultEnvelope {
  const partitioned = partitionCreatedIds(
    board,
    m.createdIds,
    m.createdStackIds ?? (m.stackId ? [m.stackId] : undefined),
  )
  const wantItems = [
    ...new Set([...(m.itemIds ?? []), ...partitioned.createdIds]),
  ]
  const wantStacks = partitioned.createdStackIds
  const verified = verifyBoardHas(board, {
    itemIds: wantItems,
    stackIds: wantStacks,
  })

  if (
    !m.dryRun &&
    (verified.missingItems.length > 0 || verified.missingStacks.length > 0)
  ) {
    throw new BoardOpsError(
      'INTERNAL',
      'Read-after-write verification failed: created objects not found on board',
      JSON.stringify({
        missingItems: verified.missingItems,
        missingStacks: verified.missingStacks,
      }),
    )
  }

  return {
    ok: true,
    createdIds: partitioned.createdIds,
    createdStackIds: partitioned.createdStackIds,
    changedIds: m.changedIds,
    verified: {
      items: verified.items,
      stacks: verified.stacks,
    },
    revision: opts.revision,
    persisted: opts.persisted,
    visibleInLiveBoard: opts.visibleInLiveBoard,
    dirty: opts.dirty,
    pendingUserSave: opts.pendingUserSave,
    autoSaved: opts.autoSaved === true,
    dryRun: m.dryRun,
    stackId: m.stackId ?? partitioned.createdStackIds[0],
    itemIds: m.itemIds ?? partitioned.createdIds,
    warnings: m.warnings,
    meta: getBoardMeta(board),
  }
}

/** Root free-item count for meta clarity. */
export function countItemsInContainer(
  board: BoardView,
  containerId: string,
): number {
  const cid =
    !containerId || containerId === 'home' ? ROOT_CONTAINER_ID : containerId
  return board.items.filter((i) => containerOf(i) === cid).length
}
