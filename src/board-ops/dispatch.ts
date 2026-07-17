/**
 * Dispatch a single agent op against a BoardView (pure).
 * Live/file backends share this so behavior stays consistent.
 */

import {
  buildStackTree,
  exportText,
  getBoardMeta,
  getItem,
  listItems,
  searchItems,
} from './read'
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
}

export type DispatchResult = {
  board: BoardView
  response: unknown
  /** Present when the op mutated the board */
  mutation?: BoardMutationResult & {
    stackId?: string
    itemIds?: string[]
  }
}

function mutationPayload(
  m: BoardMutationResult & { stackId?: string; itemIds?: string[] },
  board: BoardView,
): MutationApplyResult {
  return {
    createdIds: m.createdIds,
    changedIds: m.changedIds,
    dryRun: m.dryRun,
    dirty: !m.dryRun,
    meta: getBoardMeta(board),
    stackId: m.stackId,
    itemIds: m.itemIds,
  }
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
      return {
        board: m.board,
        mutation: m,
        response: mutationPayload(m, m.board),
      }
    }

    case 'create_notes': {
      const m = createNotesBatch(board, body.notes, body.options)
      return {
        board: m.board,
        mutation: m,
        response: mutationPayload(m, m.board),
      }
    }

    case 'update_text': {
      const m = updateText(board, body.input, body.options)
      return {
        board: m.board,
        mutation: m,
        response: mutationPayload(m, m.board),
      }
    }

    case 'move_items': {
      const m = moveItems(board, body.input, body.options)
      return {
        board: m.board,
        mutation: m,
        response: mutationPayload(m, m.board),
      }
    }

    case 'create_link': {
      const m = createLink(board, body.input, body.options)
      return {
        board: m.board,
        mutation: m,
        response: mutationPayload(m, m.board),
      }
    }

    case 'create_stack': {
      const m = createStack(board, body.input, body.options)
      return {
        board: m.board,
        mutation: m,
        response: mutationPayload(m, m.board),
      }
    }

    case 'rename_stack': {
      const m = renameStack(board, body.id, body.name, body.options)
      return {
        board: m.board,
        mutation: m,
        response: mutationPayload(m, m.board),
      }
    }

    case 'move_to_container': {
      const m = moveToContainer(board, body.input, body.options)
      return {
        board: m.board,
        mutation: m,
        response: mutationPayload(m, m.board),
      }
    }

    case 'layout_grid': {
      const m = layoutGrid(board, body.input, body.options)
      return {
        board: m.board,
        mutation: m,
        response: mutationPayload(m, m.board),
      }
    }

    case 'create_image': {
      const m = createImage(board, body.input, body.options)
      return {
        board: m.board,
        mutation: m,
        response: mutationPayload(m, m.board),
      }
    }

    case 'add_research_cluster': {
      const m = addResearchCluster(board, body.input, body.options)
      return {
        board: m.board,
        mutation: m,
        response: {
          ...mutationPayload(m, m.board),
          stackId: m.stackId,
          itemIds: m.itemIds,
        },
      }
    }

    default:
      throw new BoardOpsError(
        'INVALID_PATCH',
        `Unknown agent op: ${(body as { op?: string }).op}`,
      )
  }
}
