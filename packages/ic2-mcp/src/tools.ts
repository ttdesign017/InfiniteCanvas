/**
 * Register ic2_* MCP tools on an McpServer instance.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  buildStackTree,
  createNote,
  createNotesBatch,
  exportText,
  getBoardMeta,
  getItem,
  listItems,
  moveItems,
  searchItems,
  updateText,
} from '../../../src/board-ops/index'
import {
  boardErrorToJson,
  isBoardOpsError,
} from '../../../src/board-ops/errors'
import { ROOT_CONTAINER_ID } from '../../../src/types/canvas'
import type { Session } from './session.js'
import {
  applyMutation,
  assertWritable,
  openBoard,
  requireBoard,
  saveBoard,
} from './session.js'

function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text:
          typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  }
}

function errorResult(err: unknown) {
  const payload = boardErrorToJson(err)
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  }
}

async function runTool<T>(fn: () => T | Promise<T>) {
  try {
    const data = await fn()
    return textResult(data)
  } catch (err) {
    if (!isBoardOpsError(err)) {
      console.error('[ic2-mcp]', err)
    }
    return errorResult(err)
  }
}

export function registerTools(server: McpServer, session: Session): void {
  server.tool(
    'ic2_board_open',
    'Open an Infinite Canvas .icanvas (or legacy .json) file and bind it as the working board.',
    {
      path: z.string().describe('Absolute path to the .icanvas file'),
    },
    async ({ path }) =>
      runTool(() => {
        const view = openBoard(session, path)
        return {
          path: session.path,
          meta: getBoardMeta(view),
          dirty: session.dirty,
        }
      }),
  )

  server.tool(
    'ic2_board_info',
    'Return metadata for the currently open board (counts, viewport, apiVersion).',
    {},
    async () =>
      runTool(() => {
        const { view } = requireBoard(session)
        return {
          path: session.path,
          dirty: session.dirty,
          allowWrite: session.config.allowWrite,
          meta: getBoardMeta(view),
        }
      }),
  )

  server.tool(
    'ic2_board_save',
    'Save the working board to disk (requires IC2_MCP_ALLOW_WRITE=1). Preserves packed media assets from open.',
    {
      path: z
        .string()
        .optional()
        .describe('Optional path; defaults to the path used at open'),
    },
    async ({ path }) =>
      runTool(() => {
        const out = saveBoard(session, path ?? null)
        return { saved: true, ...out, dirty: session.dirty }
      }),
  )

  server.tool(
    'ic2_tree',
    'List nested stack folders as a tree. containerId defaults to root (home canvas).',
    {
      containerId: z
        .string()
        .optional()
        .describe('Parent container id; default root'),
      depth: z
        .number()
        .int()
        .min(0)
        .max(32)
        .optional()
        .describe('Max nesting depth (default 8)'),
    },
    async ({ containerId, depth }) =>
      runTool(() => {
        const { view } = requireBoard(session)
        return buildStackTree(view, {
          containerId: containerId ?? ROOT_CONTAINER_ID,
          depth,
        })
      }),
  )

  server.tool(
    'ic2_list_items',
    'List item summaries in one container. Media bytes are never included.',
    {
      containerId: z
        .string()
        .describe('Container id: root or a stack id (required)'),
      type: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe('Filter by item type(s)'),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async ({ containerId, type, limit, offset }) =>
      runTool(() => {
        const { view } = requireBoard(session)
        return listItems(view, {
          containerId,
          type: type as never,
          limit,
          offset,
        })
      }),
  )

  server.tool(
    'ic2_get_item',
    'Get one item detail by id (text content allowed; no media payloads).',
    {
      id: z.string(),
    },
    async ({ id }) =>
      runTool(() => {
        const { view } = requireBoard(session)
        return getItem(view, { id })
      }),
  )

  server.tool(
    'ic2_export_text',
    'Export notes and link cards in a container as LLM-friendly text blocks.',
    {
      containerId: z.string(),
      ids: z.array(z.string()).optional(),
      maxCharsPerItem: z.number().int().min(40).max(20000).optional(),
    },
    async (args) =>
      runTool(() => {
        const { view } = requireBoard(session)
        return exportText(view, args)
      }),
  )

  server.tool(
    'ic2_search',
    'Substring search over labels, note content, link fields, and filenames.',
    {
      query: z.string(),
      containerId: z.string().optional(),
      type: z.union([z.string(), z.array(z.string())]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ query, containerId, type, limit }) =>
      runTool(() => {
        const { view } = requireBoard(session)
        return searchItems(view, {
          query,
          containerId,
          type: type as never,
          limit,
        })
      }),
  )

  server.tool(
    'ic2_create_note',
    'Create a textcard (default) or free text note. Requires write mode. Use dry_run to preview.',
    {
      containerId: z.string(),
      x: z.number(),
      y: z.number(),
      content: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      kind: z.enum(['textcard', 'text']).optional(),
      clientRequestId: z.string().optional(),
      dry_run: z.boolean().optional(),
    },
    async (args) =>
      runTool(() => {
        assertWritable(session)
        const { view } = requireBoard(session)
        const result = createNote(
          view,
          {
            containerId: args.containerId,
            x: args.x,
            y: args.y,
            content: args.content,
            width: args.width,
            height: args.height,
            kind: args.kind,
            clientRequestId: args.clientRequestId,
          },
          { dryRun: args.dry_run === true },
        )
        applyMutation(session, result)
        return {
          dryRun: result.dryRun,
          createdIds: result.createdIds,
          dirty: session.dirty,
        }
      }),
  )

  server.tool(
    'ic2_create_notes',
    'Create multiple notes as one logical change (batch). Requires write mode.',
    {
      notes: z.array(
        z.object({
          containerId: z.string(),
          x: z.number(),
          y: z.number(),
          content: z.string().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          kind: z.enum(['textcard', 'text']).optional(),
          clientRequestId: z.string().optional(),
        }),
      ),
      dry_run: z.boolean().optional(),
    },
    async ({ notes, dry_run }) =>
      runTool(() => {
        assertWritable(session)
        const { view } = requireBoard(session)
        const result = createNotesBatch(view, notes, {
          dryRun: dry_run === true,
        })
        applyMutation(session, result)
        return {
          dryRun: result.dryRun,
          createdIds: result.createdIds,
          dirty: session.dirty,
        }
      }),
  )

  server.tool(
    'ic2_update_text',
    'Update whitelist fields on a text/textcard item. Requires write mode.',
    {
      id: z.string(),
      content: z.string().optional(),
      color: z.string().optional(),
      backgroundColor: z.string().optional(),
      fontSize: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      dry_run: z.boolean().optional(),
    },
    async (args) =>
      runTool(() => {
        assertWritable(session)
        const { view } = requireBoard(session)
        const { dry_run, ...input } = args
        const result = updateText(view, input, {
          dryRun: dry_run === true,
        })
        applyMutation(session, result)
        return {
          dryRun: result.dryRun,
          changedIds: result.changedIds,
          dirty: session.dirty,
        }
      }),
  )

  server.tool(
    'ic2_move_items',
    'Set absolute poses for free items. Requires write mode.',
    {
      moves: z.array(
        z.object({
          id: z.string(),
          x: z.number().optional(),
          y: z.number().optional(),
          rotation: z.number().optional(),
        }),
      ),
      dry_run: z.boolean().optional(),
    },
    async ({ moves, dry_run }) =>
      runTool(() => {
        assertWritable(session)
        const { view } = requireBoard(session)
        const result = moveItems(
          view,
          { moves },
          { dryRun: dry_run === true },
        )
        applyMutation(session, result)
        return {
          dryRun: result.dryRun,
          changedIds: result.changedIds,
          dirty: session.dirty,
        }
      }),
  )
}
