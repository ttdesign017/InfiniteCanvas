/**
 * In-process board session for the MCP server (file mode).
 */

import type { BoardSnapshot } from '../../../src/types/canvas'
import { ROOT_CONTAINER_ID } from '../../../src/types/canvas'
import {
  boardViewFromSnapshot,
  type BoardMutationResult,
  type BoardView,
} from '../../../src/board-ops/types'
import { BoardOpsError } from '../../../src/board-ops/errors'
import { loadSnapshotFromPath, saveSnapshotToPath } from './nodeFile.js'
import type { McpConfig } from './config.js'

export type Session = {
  config: McpConfig
  path: string | null
  snapshot: BoardSnapshot | null
  dirty: boolean
  revision: number
}

export function createSession(config: McpConfig): Session {
  return {
    config,
    path: null,
    snapshot: null,
    dirty: false,
    revision: 0,
  }
}

export function requireBoard(session: Session): {
  view: BoardView
  snapshot: BoardSnapshot
} {
  if (!session.snapshot) {
    throw new BoardOpsError(
      'OPEN_FAILED',
      'No board open. Call ic2_board_open with a path first.',
    )
  }
  return {
    view: boardViewFromSnapshot(session.snapshot),
    snapshot: session.snapshot,
  }
}

export function openBoard(session: Session, path: string): BoardView {
  const snapshot = loadSnapshotFromPath(path)
  session.snapshot = snapshot
  session.path = path
  session.dirty = false
  return boardViewFromSnapshot(snapshot)
}

/** Apply a pure mutation result back onto the session snapshot (one unit). */
export function applyMutation(
  session: Session,
  result: BoardMutationResult,
): void {
  if (!session.snapshot) {
    throw new BoardOpsError('OPEN_FAILED', 'No board open')
  }
  if (result.dryRun) return

  const prev = session.snapshot
  session.revision = (session.revision || 0) + 1
  session.snapshot = {
    ...prev,
    name: result.board.name,
    items: result.board.items,
    stacks: result.board.stacks,
    viewport: result.board.viewport,
    homeViewport: result.board.homeViewport,
    nextZ: result.board.nextZ,
    currentContainerId:
      result.board.currentContainerId || ROOT_CONTAINER_ID,
    // Keep packed media from open so save does not drop assets
    packedAssets: prev.packedAssets,
  }
  session.dirty = true
  // Read-after-write: ensure stacks/items from mutation exist
  for (const id of result.createdIds) {
    if (!session.snapshot.items.some((i) => i.id === id)) {
      // stack ids may be in createdStackIds only
      const stackIds = result.createdStackIds ?? []
      if (!stackIds.includes(id) && !session.snapshot.stacks.some((s) => s.id === id)) {
        throw new BoardOpsError(
          'INTERNAL',
          `File-session verify failed: missing ${id}`,
          id,
        )
      }
    }
  }
  for (const id of result.createdStackIds ?? []) {
    if (!session.snapshot.stacks.some((s) => s.id === id)) {
      throw new BoardOpsError(
        'INTERNAL',
        `File-session verify failed: missing stack ${id}`,
        id,
      )
    }
  }
}

export function assertWritable(session: Session): void {
  if (!session.config.allowWrite) {
    throw new BoardOpsError(
      'WRITE_DENIED',
      'Write tools are disabled. Set IC2_MCP_ALLOW_WRITE=1 to enable.',
    )
  }
}

export function saveBoard(
  session: Session,
  path?: string | null,
): { path: string; name: string } {
  assertWritable(session)
  if (!session.snapshot) {
    throw new BoardOpsError('OPEN_FAILED', 'No board open')
  }
  const target = path || session.path
  if (!target) {
    throw new BoardOpsError(
      'SAVE_FAILED',
      'No path. Pass path to ic2_board_save or open a file first.',
    )
  }
  const out = saveSnapshotToPath(session.snapshot, target)
  session.path = out.path
  session.snapshot = { ...session.snapshot, name: out.name }
  session.dirty = false
  return out
}
