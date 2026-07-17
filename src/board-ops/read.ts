/**
 * Pure read operations over a board view / snapshot.
 * All container queries take an explicit containerId (use `root` for home).
 */

import type { CanvasItem, StackRecord } from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { containerOf } from '../utils/stacks'
import { BOARD_OPS_API_VERSION } from './dto'
import { BoardOpsError } from './errors'
import { toItemDetail, toItemSummary, toStackSummary, itemLabel } from './project'
import type {
  BoardMetaResult,
  BoardView,
  ExportTextQuery,
  ExportTextResult,
  GetItemQuery,
  GetItemResult,
  ListItemsQuery,
  ListItemsResult,
  SearchQuery,
  SearchResult,
  TreeQuery,
  TreeResult,
} from './types'
import type { StackTreeNodeDto } from './dto'

function normalizeContainerId(id: string | undefined): string {
  if (!id || id === 'home') return ROOT_CONTAINER_ID
  return id
}

function assertContainerExists(
  containerId: string,
  stacks: StackRecord[],
): void {
  const cid = normalizeContainerId(containerId)
  if (cid === ROOT_CONTAINER_ID) return
  if (!stacks.some((s) => s.id === cid)) {
    throw new BoardOpsError(
      'CONTAINER_NOT_FOUND',
      `Container not found: ${cid}`,
      cid,
    )
  }
}

function typeMatches(
  item: CanvasItem,
  type: CanvasItem['type'] | CanvasItem['type'][] | undefined,
): boolean {
  if (!type) return true
  if (Array.isArray(type)) return type.includes(item.type)
  return item.type === type
}

export function getBoardMeta(board: BoardView): BoardMetaResult {
  const currentContainerId = normalizeContainerId(board.currentContainerId)
  const rootItemCount = board.items.filter(
    (i) => containerOf(i) === ROOT_CONTAINER_ID,
  ).length
  const currentContainerItemCount = board.items.filter(
    (i) => containerOf(i) === currentContainerId,
  ).length
  return {
    name: board.name,
    itemCount: board.items.length,
    rootItemCount,
    stackCount: board.stacks.length,
    currentContainerId,
    currentContainerItemCount,
    viewport: { ...board.viewport },
    homeViewport: board.homeViewport
      ? { ...board.homeViewport }
      : undefined,
    nextZ: board.nextZ,
    revision: board.revision,
    apiVersion: BOARD_OPS_API_VERSION,
    countsNote:
      'itemCount is global (all containers). list_items(containerId) is per-surface. Stack folders are not items — use createdStackIds / ic2_tree, not get_item(stackId).',
  }
}

/** Resolve a stack or throw STACK_NOT_FOUND (for agents that confused stack vs item). */
export function getStack(
  board: BoardView,
  id: string,
): {
  id: string
  parentId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  itemCount: number
} {
  const st = board.stacks.find((s) => s.id === id)
  if (!st) {
    // Helpful error if they passed an item id
    if (board.items.some((i) => i.id === id)) {
      throw new BoardOpsError(
        'STACK_NOT_FOUND',
        `Id ${id} is an item, not a stack. Use ic2_get_item.`,
        id,
      )
    }
    throw new BoardOpsError('STACK_NOT_FOUND', `Stack not found: ${id}`, id)
  }
  const itemCount = board.items.filter((i) => containerOf(i) === st.id).length
  return {
    id: st.id,
    parentId: st.parentId || ROOT_CONTAINER_ID,
    name: st.name || '',
    x: st.x,
    y: st.y,
    width: st.width,
    height: st.height,
    zIndex: st.zIndex,
    itemCount,
  }
}

export function listItems(
  board: BoardView,
  query: ListItemsQuery,
): ListItemsResult {
  const containerId = normalizeContainerId(query.containerId)
  assertContainerExists(containerId, board.stacks)

  const filtered = board.items.filter(
    (i) =>
      containerOf(i) === containerId && typeMatches(i, query.type),
  )
  // Stable paint-ish order: z then id
  filtered.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))

  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.min(500, Math.max(1, query.limit ?? 100))
  const page = filtered.slice(offset, offset + limit)

  return {
    items: page.map(toItemSummary),
    total: filtered.length,
  }
}

export function getItem(
  board: BoardView,
  query: GetItemQuery,
): GetItemResult {
  const item = board.items.find((i) => i.id === query.id)
  if (!item) {
    if (board.stacks.some((s) => s.id === query.id)) {
      throw new BoardOpsError(
        'ITEM_NOT_FOUND',
        `Id ${query.id} is a stack folder, not an item. Use ic2_get_stack or ic2_list_items({ containerId: stackId }).`,
        query.id,
      )
    }
    throw new BoardOpsError(
      'ITEM_NOT_FOUND',
      `Item not found: ${query.id}`,
      query.id,
    )
  }
  return toItemDetail(item)
}

export function buildStackTree(
  board: BoardView,
  query: TreeQuery = {},
): TreeResult {
  const rootId = normalizeContainerId(query.containerId ?? ROOT_CONTAINER_ID)
  assertContainerExists(rootId, board.stacks)
  const maxDepth = Math.min(32, Math.max(0, query.depth ?? 8))

  const build = (parentId: string, depth: number): StackTreeNodeDto[] => {
    if (depth > maxDepth) return []
    const kids = board.stacks
      .filter((s) => (s.parentId || ROOT_CONTAINER_ID) === parentId)
      .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
    return kids.map((st) => {
      const summary = toStackSummary(st, board.items, board.stacks)
      return {
        ...summary,
        children: build(st.id, depth + 1),
      }
    })
  }

  return { roots: build(rootId, 0) }
}

export function exportText(
  board: BoardView,
  query: ExportTextQuery,
): ExportTextResult {
  const containerId = normalizeContainerId(query.containerId)
  assertContainerExists(containerId, board.stacks)
  const maxChars = Math.min(20_000, Math.max(40, query.maxCharsPerItem ?? 4000))
  const idFilter = query.ids ? new Set(query.ids) : null

  const blocks = board.items
    .filter((i) => containerOf(i) === containerId)
    .filter((i) => !idFilter || idFilter.has(i.id))
    .filter(
      (i) =>
        i.type === 'text' ||
        i.type === 'textcard' ||
        i.type === 'link',
    )
    .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
    .map((i) => {
      let text = ''
      if (i.type === 'text' || i.type === 'textcard') text = i.content || ''
      else if (i.type === 'link') {
        text = [i.title, i.description, i.url].filter(Boolean).join('\n')
      }
      if (text.length > maxChars) text = text.slice(0, maxChars) + '…'
      return {
        id: i.id,
        type: i.type,
        containerId,
        label: itemLabel(i),
        text,
      }
    })

  const plainText = blocks
    .map((b) => `## ${b.label} (${b.id})\n${b.text}`)
    .join('\n\n')

  return { blocks, plainText }
}

export function searchItems(
  board: BoardView,
  query: SearchQuery,
): SearchResult {
  const q = query.query.trim().toLowerCase()
  if (!q) return { items: [] }

  const containerId = query.containerId
    ? normalizeContainerId(query.containerId)
    : null
  if (containerId) assertContainerExists(containerId, board.stacks)

  const limit = Math.min(100, Math.max(1, query.limit ?? 30))
  const hits: CanvasItem[] = []

  for (const item of board.items) {
    if (containerId && containerOf(item) !== containerId) continue
    if (!typeMatches(item, query.type)) continue

    const hay: string[] = [item.id, item.type, itemLabel(item)]
    if (item.type === 'text' || item.type === 'textcard') {
      hay.push(item.content || '')
    }
    if (item.type === 'link') {
      hay.push(item.url || '', item.title || '', item.description || '')
    }
    if (
      item.type === 'image' ||
      item.type === 'gif' ||
      item.type === 'video' ||
      item.type === 'audio'
    ) {
      hay.push(item.fileName || '')
    }

    if (hay.join('\n').toLowerCase().includes(q)) {
      hits.push(item)
      if (hits.length >= limit) break
    }
  }

  return { items: hits.map(toItemSummary) }
}

/** Resolve a stack record or throw. */
export function requireStack(
  board: BoardView,
  stackId: string,
): StackRecord {
  const st = board.stacks.find((s) => s.id === stackId)
  if (!st) {
    throw new BoardOpsError(
      'STACK_NOT_FOUND',
      `Stack not found: ${stackId}`,
      stackId,
    )
  }
  return st
}
