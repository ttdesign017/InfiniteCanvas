/**
 * Dispatch a single agent op against a BoardView (pure).
 * Live/file backends share this so behavior stays consistent.
 */

import {
  buildStackTree,
  exportText,
  getBoardMeta,
  getItem,
  getStack,
  listItems,
  searchItems,
} from './read'
import {
  buildWriteEnvelope,
  nextRevision,
  withRevision,
  type PersistState,
} from './writeResult'
import {
  createNote,
  createNotesBatch,
  moveItems,
  updateText,
} from './write'
import {
  addResearchCluster,
  createImage,
  createLink,
  createStack,
  layoutGrid,
  moveToContainer,
  renameStack,
  worldRectFromViewport,
} from './writeExtras'
import type { AgentOp, MutationApplyResult, ViewportInfo } from './agentProtocol'
import type { BoardMutationResult, BoardView } from './types'
import { BoardOpsError } from './errors'
import { ROOT_CONTAINER_ID } from '../types/canvas'

export type DispatchContext = {
  board: BoardView
  /** Screen size for viewport world rect (live provides real size). */
  screen?: { width: number; height: number }
  /** How this dispatch will be persisted (affects response envelope). */
  persist?: PersistState
  /** Live board is currently visible */
  visibleInLiveBoard?: boolean
}

export type DispatchResult = {
  board: BoardView
  response: unknown
  /** Present when the op mutated the board */
  mutation?: BoardMutationResult & {
    stackId?: string
    itemIds?: string[]
    createdStackIds?: string[]
    warnings?: string[]
  }
}

function mutationPayload(
  m: BoardMutationResult & {
    stackId?: string
    itemIds?: string[]
    createdStackIds?: string[]
    warnings?: string[]
  },
  board: BoardView,
  ctx: DispatchContext,
): MutationApplyResult {
  const revision = nextRevision(board)
  const boardRev = withRevision(board, revision)
  const persist = ctx.persist ?? 'memory'
  const live = ctx.visibleInLiveBoard === true || persist === 'live'
  return buildWriteEnvelope(boardRev, m, {
    revision,
    persisted: persist,
    visibleInLiveBoard: live,
    dirty: !m.dryRun,
    pendingUserSave: !m.dryRun && (persist === 'live' || persist === 'memory'),
    autoSaved: false,
  })
}

export function dispatchAgentOp(
  ctx: DispatchContext,
  body: AgentOp,
): DispatchResult {
  const board = ctx.board
  const screen = ctx.screen ?? { width: 1440, height: 900 }

  switch (body.op) {
    case 'ping':
      return { board, response: { pong: true, t: Date.now() } }

    case 'get_meta':
      return { board, response: getBoardMeta(board) }

    case 'get_viewport': {
      const worldRect = worldRectFromViewport(
        board.viewport,
        screen.width,
        screen.height,
      )
      const info: ViewportInfo = {
        viewport: { ...board.viewport },
        worldRect,
        screen,
        currentContainerId: board.currentContainerId || ROOT_CONTAINER_ID,
      }
      return { board, response: info }
    }

    case 'tree':
      return {
        board,
        response: buildStackTree(board, {
          containerId: body.containerId,
          depth: body.depth,
        }),
      }

    case 'list_items':
      return {
        board,
        response: listItems(board, {
          containerId: body.containerId,
          type: body.type as never,
          limit: body.limit,
          offset: body.offset,
        }),
      }

    case 'get_item':
      return { board, response: getItem(board, { id: body.id }) }

    case 'get_stack':
      return { board, response: getStack(board, body.id) }

    case 'export_text':
      return {
        board,
        response: exportText(board, {
          containerId: body.containerId,
          ids: body.ids,
          maxCharsPerItem: body.maxCharsPerItem,
        }),
      }

    case 'search':
      return {
        board,
        response: searchItems(board, {
          query: body.query,
          containerId: body.containerId,
          type: body.type as never,
          limit: body.limit,
        }),
      }

    case 'create_note': {
      const m = createNote(board, body.input, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    case 'create_notes': {
      const m = createNotesBatch(board, body.notes, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    case 'update_text': {
      const m = updateText(board, body.input, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    case 'move_items': {
      const m = moveItems(board, body.input, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    case 'create_link': {
      const m = createLink(board, body.input, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    case 'create_stack': {
      const m = createStack(board, body.input, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    case 'rename_stack': {
      const m = renameStack(board, body.id, body.name, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    case 'move_to_container': {
      const m = moveToContainer(board, body.input, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    case 'layout_grid': {
      const m = layoutGrid(board, body.input, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    case 'create_image': {
      const m = createImage(board, body.input, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    case 'add_research_cluster': {
      const m = addResearchCluster(board, body.input, body.options)
      const revBoard = withRevision(m.board, nextRevision(m.board))
      return {
        board: revBoard,
        mutation: { ...m, board: revBoard },
        response: mutationPayload(m, revBoard, ctx),
      }
    }

    default:
      throw new BoardOpsError(
        'INVALID_PATCH',
        `Unknown agent op: ${(body as { op?: string }).op}`,
      )
  }
}
