/**
 * In-process MCP smoke test (no stdio host).
 * Usage: node --import tsx scripts/smoke-test.mjs [path-to.icanvas]
 */

import { createSession, openBoard, requireBoard, applyMutation, assertWritable } from '../src/session.ts'
import {
  getBoardMeta,
  buildStackTree,
  listItems,
  exportText,
  searchItems,
  createNote,
  getItem,
} from '../../../src/board-ops/index.ts'
import { ROOT_CONTAINER_ID } from '../../../src/types/canvas.ts'

const path =
  process.argv[2] ||
  process.env.IC2_MCP_BOARD_PATH ||
  `${process.env.USERPROFILE}\\Desktop\\test.icanvas`

const t0 = performance.now()
const log = (step, data) => {
  const ms = (performance.now() - t0).toFixed(0)
  console.log(`\n=== [${ms}ms] ${step} ===`)
  if (typeof data === 'string') console.log(data)
  else console.log(JSON.stringify(data, null, 2))
}

async function main() {
  console.log('Board path:', path)
  const session = createSession({ allowWrite: true, initialBoardPath: null })

  // 1) open
  const view = openBoard(session, path)
  const meta = getBoardMeta(view)
  log('ic2_board_open / info', {
    path: session.path,
    dirty: session.dirty,
    meta,
  })

  // 2) tree
  const tree = buildStackTree(view, {
    containerId: ROOT_CONTAINER_ID,
    depth: 3,
  })
  log('ic2_tree (depth=3)', {
    rootStackCount: tree.roots.length,
    roots: tree.roots.map((r) => ({
      id: r.id,
      name: r.name,
      items: r.itemCount,
      children: r.children.length,
    })),
  })

  // 3) list root
  const listed = listItems(view, {
    containerId: ROOT_CONTAINER_ID,
    limit: 15,
  })
  log('ic2_list_items (root, limit=15)', {
    total: listed.total,
    sample: listed.items.map((i) => ({
      id: i.id,
      type: i.type,
      label: i.label,
      media: i.media?.fileName,
    })),
  })

  // 4) get first text-like if any
  const textish = listed.items.find(
    (i) => i.type === 'text' || i.type === 'textcard' || i.type === 'link',
  )
  if (textish) {
    const detail = getItem(view, { id: textish.id })
    log('ic2_get_item', {
      id: detail.id,
      type: detail.type,
      label: detail.label,
      contentPreview: (detail.content || '').slice(0, 200),
    })
  } else {
    log('ic2_get_item', 'skipped (no text/link in first page)')
  }

  // 5) export text
  const exported = exportText(view, {
    containerId: ROOT_CONTAINER_ID,
    maxCharsPerItem: 200,
  })
  log('ic2_export_text (root)', {
    blockCount: exported.blocks.length,
    plainPreview: exported.plainText.slice(0, 400),
  })

  // 6) search
  const q = listed.items[0]?.label?.slice(0, 4) || 'a'
  const found = searchItems(view, { query: q, limit: 5 })
  log(`ic2_search query="${q}"`, {
    hits: found.items.map((i) => ({ id: i.id, type: i.type, label: i.label })),
  })

  // 7) dry_run create note (no save, no mutate session if we don't apply)
  const dry = createNote(
    requireBoard(session).view,
    {
      containerId: ROOT_CONTAINER_ID,
      x: 40,
      y: 40,
      content: '[ic2-mcp smoke] dry-run note — safe to ignore',
    },
    { dryRun: true },
  )
  log('ic2_create_note dry_run', {
    dryRun: dry.dryRun,
    createdIds: dry.createdIds,
    nextItemCount: dry.board.items.length,
    sessionDirty: session.dirty,
  })

  // 8) write deny path when allowWrite false
  const ro = createSession({ allowWrite: false, initialBoardPath: null })
  openBoard(ro, path)
  let denied = false
  try {
    assertWritable(ro)
  } catch (e) {
    denied = e?.code === 'WRITE_DENIED'
  }
  log('WRITE_DENIED when allowWrite=false', { denied })

  log('DONE', {
    totalMs: Math.round(performance.now() - t0),
    ok: true,
    note: 'Original file was not modified (dry_run only).',
  })
}

main().catch((err) => {
  console.error('SMOKE FAILED', err)
  process.exit(1)
})
