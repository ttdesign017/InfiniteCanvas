/**
 * Register ic2_* MCP tools — live app preferred, file session fallback.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  boardErrorToJson,
  isBoardOpsError,
} from '../../../src/board-ops/errors'
import { ROOT_CONTAINER_ID } from '../../../src/types/canvas'
import type { Session } from './session'
import { assertWritable } from './session'
import {
  getBackendMode,
  openFileBoard,
  runOp,
  saveFileBoard,
  statusInfo,
} from './backend'
import { getBoardMeta } from '../../../src/board-ops/index'
import { fetchImageAsDataUrl } from './fetchImage'

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
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  }
}

async function runTool<T>(fn: () => T | Promise<T>) {
  try {
    return textResult(await fn())
  } catch (err) {
    if (!isBoardOpsError(err)) console.error('[ic2-mcp]', err)
    return errorResult(err)
  }
}

export function registerTools(server: McpServer, session: Session): void {
  server.tool(
    'ic2_status',
    'Show whether Infinite Canvas is live, file session state, and write flags.',
    {},
    async () => runTool(() => statusInfo(session)),
  )

  server.tool(
    'ic2_board_open',
    'Open a .icanvas file into the MCP file session (fallback when app is not live). Prefer live app for realtime canvas.',
    { path: z.string() },
    async ({ path }) =>
      runTool(() => {
        const view = openFileBoard(session, path)
        return {
          mode: 'file',
          path: session.path,
          meta: getBoardMeta(view),
          hint: isLiveHint(),
        }
      }),
  )

  server.tool(
    'ic2_board_info',
    'Board metadata (live window or file session).',
    {},
    async () =>
      runTool(async () => {
        const status = statusInfo(session)
        if (getBackendMode(session) === 'live') {
          const meta = await runOp(session, { op: 'get_meta' })
          return { mode: 'live', meta, status }
        }
        if (getBackendMode(session) === 'file') {
          const meta = await runOp(session, { op: 'get_meta' })
          return {
            mode: 'file',
            path: session.path,
            dirty: session.dirty,
            meta,
            status,
          }
        }
        return {
          mode: 'none',
          status,
          hint: 'Open Infinite Canvas (live) or ic2_board_open a .icanvas file.',
        }
      }),
  )

  server.tool(
    'ic2_board_save',
    'Save the file-session board to disk (file mode only). Live mode keeps dirty state in the app — use the app Save.',
    { path: z.string().optional() },
    async ({ path }) =>
      runTool(() => {
        assertWritable(session)
        if (getBackendMode(session) === 'live') {
          return {
            saved: false,
            mode: 'live',
            message:
              'Live mode: content is already on the open canvas. Use Infinite Canvas Save (Ctrl+S).',
          }
        }
        const out = saveFileBoard(session, path ?? null)
        return { saved: true, mode: 'file', ...out }
      }),
  )

  server.tool(
    'ic2_get_viewport',
    'Current viewport + approximate visible world rect (best with live app).',
    {},
    async () => runTool(() => runOp(session, { op: 'get_viewport' })),
  )

  server.tool(
    'ic2_tree',
    'Nested stack tree. containerId defaults to root.',
    {
      containerId: z.string().optional(),
      depth: z.number().int().min(0).max(32).optional(),
    },
    async ({ containerId, depth }) =>
      runTool(() =>
        runOp(session, {
          op: 'tree',
          containerId: containerId ?? ROOT_CONTAINER_ID,
          depth,
        }),
      ),
  )

  server.tool(
    'ic2_list_items',
    'List item summaries in one container (no media bytes).',
    {
      containerId: z.string(),
      type: z.union([z.string(), z.array(z.string())]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async (args) =>
      runTool(() =>
        runOp(session, {
          op: 'list_items',
          containerId: args.containerId,
          type: args.type,
          limit: args.limit,
          offset: args.offset,
        }),
      ),
  )

  server.tool(
    'ic2_get_item',
    'Get one item detail (text ok; no media payloads). Do NOT pass stack folder ids — use ic2_get_stack.',
    { id: z.string() },
    async ({ id }) => runTool(() => runOp(session, { op: 'get_item', id })),
  )

  server.tool(
    'ic2_get_stack',
    'Get a stack folder by id (not an item). Use after ic2_create_stack / research_cluster.',
    { id: z.string() },
    async ({ id }) => runTool(() => runOp(session, { op: 'get_stack', id })),
  )

  server.tool(
    'ic2_export_text',
    'Export notes/links in a container as text for reasoning.',
    {
      containerId: z.string(),
      ids: z.array(z.string()).optional(),
      maxCharsPerItem: z.number().int().optional(),
    },
    async (args) =>
      runTool(() =>
        runOp(session, {
          op: 'export_text',
          containerId: args.containerId,
          ids: args.ids,
          maxCharsPerItem: args.maxCharsPerItem,
        }),
      ),
  )

  server.tool(
    'ic2_search',
    'Search labels/content/filenames.',
    {
      query: z.string(),
      containerId: z.string().optional(),
      type: z.union([z.string(), z.array(z.string())]).optional(),
      limit: z.number().int().optional(),
    },
    async (args) =>
      runTool(() =>
        runOp(session, {
          op: 'search',
          query: args.query,
          containerId: args.containerId,
          type: args.type,
          limit: args.limit,
        }),
      ),
  )

  // —— writes ——
  const writeGuard = () => {
    assertWritable(session)
  }

  server.tool(
    'ic2_create_note',
    'Create a note/textcard on the canvas (live preferred).',
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
      runTool(async () => {
        writeGuard()
        return runOp(session, {
          op: 'create_note',
          input: {
            containerId: args.containerId,
            x: args.x,
            y: args.y,
            content: args.content,
            width: args.width,
            height: args.height,
            kind: args.kind,
            clientRequestId: args.clientRequestId,
          },
          options: { dryRun: args.dry_run === true },
        })
      }),
  )

  server.tool(
    'ic2_create_link',
    'Create a link/bookmark card.',
    {
      containerId: z.string(),
      x: z.number(),
      y: z.number(),
      url: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      dry_run: z.boolean().optional(),
    },
    async (args) =>
      runTool(async () => {
        writeGuard()
        return runOp(session, {
          op: 'create_link',
          input: {
            containerId: args.containerId,
            x: args.x,
            y: args.y,
            url: args.url,
            title: args.title,
            description: args.description,
          },
          options: { dryRun: args.dry_run === true },
        })
      }),
  )

  server.tool(
    'ic2_create_stack',
    'Create an enterable stack folder on a parent container.',
    {
      parentId: z.string().default(ROOT_CONTAINER_ID),
      x: z.number(),
      y: z.number(),
      name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      dry_run: z.boolean().optional(),
    },
    async (args) =>
      runTool(async () => {
        writeGuard()
        return runOp(session, {
          op: 'create_stack',
          input: {
            parentId: args.parentId,
            x: args.x,
            y: args.y,
            name: args.name,
            width: args.width,
            height: args.height,
          },
          options: { dryRun: args.dry_run === true },
        })
      }),
  )

  server.tool(
    'ic2_rename_stack',
    'Rename a stack folder.',
    {
      id: z.string(),
      name: z.string(),
      dry_run: z.boolean().optional(),
    },
    async (args) =>
      runTool(async () => {
        writeGuard()
        return runOp(session, {
          op: 'rename_stack',
          id: args.id,
          name: args.name,
          options: { dryRun: args.dry_run === true },
        })
      }),
  )

  server.tool(
    'ic2_import_image_url',
    'Download an image URL and place it on the canvas.',
    {
      containerId: z.string(),
      x: z.number(),
      y: z.number(),
      url: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      fileName: z.string().optional(),
      dry_run: z.boolean().optional(),
    },
    async (args) =>
      runTool(async () => {
        writeGuard()
        const img = await fetchImageAsDataUrl(args.url)
        return runOp(session, {
          op: 'create_image',
          input: {
            containerId: args.containerId,
            x: args.x,
            y: args.y,
            src: img.dataUrl,
            fileName: args.fileName || img.fileName,
            width: args.width,
            height: args.height,
            assetMime: img.mime,
            assetBase64: img.dataUrl.includes('base64,')
              ? img.dataUrl.split('base64,')[1]
              : undefined,
          },
          options: { dryRun: args.dry_run === true },
        })
      }),
  )

  server.tool(
    'ic2_layout_grid',
    'Lay out existing items in a grid.',
    {
      itemIds: z.array(z.string()).min(1),
      originX: z.number(),
      originY: z.number(),
      columns: z.number().int().optional(),
      gapX: z.number().optional(),
      gapY: z.number().optional(),
      cellWidth: z.number().optional(),
      cellHeight: z.number().optional(),
      dry_run: z.boolean().optional(),
    },
    async (args) =>
      runTool(async () => {
        writeGuard()
        return runOp(session, {
          op: 'layout_grid',
          input: {
            itemIds: args.itemIds,
            originX: args.originX,
            originY: args.originY,
            columns: args.columns,
            gapX: args.gapX,
            gapY: args.gapY,
            cellWidth: args.cellWidth,
            cellHeight: args.cellHeight,
          },
          options: { dryRun: args.dry_run === true },
        })
      }),
  )

  server.tool(
    'ic2_move_to_container',
    'Move items into a stack (or root) by containerId.',
    {
      itemIds: z.array(z.string()).min(1),
      containerId: z.string(),
      dry_run: z.boolean().optional(),
    },
    async (args) =>
      runTool(async () => {
        writeGuard()
        return runOp(session, {
          op: 'move_to_container',
          input: {
            itemIds: args.itemIds,
            containerId: args.containerId,
          },
          options: { dryRun: args.dry_run === true },
        })
      }),
  )

  server.tool(
    'ic2_add_research_cluster',
    'High-level: create a named stack filled with notes, links, and images. Returns createdIds (items) + createdStackIds (use get_stack / list_items(stackId)). Failed images are skipped by default (warnings).',
    {
      title: z.string(),
      parentId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      columns: z.number().int().optional(),
      clientRequestId: z
        .string()
        .optional()
        .describe('Idempotent stack id — retries will not duplicate'),
      skipInvalidImages: z
        .boolean()
        .optional()
        .describe('Default true: skip 404 images and continue'),
      notes: z
        .array(
          z.object({
            content: z.string(),
            kind: z.enum(['textcard', 'text']).optional(),
          }),
        )
        .optional(),
      links: z
        .array(
          z.object({
            url: z.string(),
            title: z.string().optional(),
            description: z.string().optional(),
          }),
        )
        .optional(),
      images: z
        .array(
          z.object({
            url: z.string().optional(),
            dataUrl: z.string().optional(),
            fileName: z.string().optional(),
            caption: z.string().optional(),
          }),
        )
        .optional(),
      dry_run: z.boolean().optional(),
    },
    async (args) =>
      runTool(async () => {
        writeGuard()
        return runOp(session, {
          op: 'add_research_cluster',
          input: {
            title: args.title,
            parentId: args.parentId,
            x: args.x,
            y: args.y,
            columns: args.columns,
            notes: args.notes,
            links: args.links,
            images: args.images,
            dryRun: args.dry_run,
            clientRequestId: args.clientRequestId,
            skipInvalidImages: args.skipInvalidImages !== false,
          },
          options: { dryRun: args.dry_run === true },
        })
      }),
  )
}

function isLiveHint() {
  return 'If Infinite Canvas is open, tools auto-use live mode and appear on the canvas immediately.'
}
