/**
 * Restricted pure writes on a BoardView.
 *
 * History semantics for agents / UI adapters:
 * - One board-ops write call = one logical undo unit when applied to the store.
 * - Use `dryRun: true` to preview without persisting.
 * - Only whitelist fields are mutable (no arbitrary media src swaps in v1).
 */

import type { CanvasItem, TextCardItem, TextItem } from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { uid } from '../utils/id'
import { containerOf } from '../utils/stacks'
import { FONT_STACKS } from '../store/canvasStoreTypes'
import { BoardOpsError } from './errors'
import type {
  BoardMutationResult,
  BoardView,
  CreateNoteInput,
  MoveItemsInput,
  UpdateTextInput,
  WriteOptions,
} from './types'

function normalizeContainerId(id: string): string {
  if (!id || id === 'home') return ROOT_CONTAINER_ID
  return id
}

function assertContainer(board: BoardView, containerId: string): string {
  const cid = normalizeContainerId(containerId)
  if (cid === ROOT_CONTAINER_ID) return cid
  if (!board.stacks.some((s) => s.id === cid)) {
    throw new BoardOpsError(
      'CONTAINER_NOT_FOUND',
      `Container not found: ${cid}`,
      cid,
    )
  }
  return cid
}

function tagContainerId(item: CanvasItem, containerId: string): CanvasItem {
  if (containerId === ROOT_CONTAINER_ID) {
    if (!item.containerId || item.containerId === ROOT_CONTAINER_ID) return item
    const { containerId: _c, ...rest } = item
    return rest as CanvasItem
  }
  return { ...item, containerId }
}

function cloneView(board: BoardView): BoardView {
  return {
    name: board.name,
    items: board.items.slice(),
    stacks: board.stacks.slice(),
    viewport: { ...board.viewport },
    homeViewport: board.homeViewport
      ? { ...board.homeViewport }
      : undefined,
    nextZ: board.nextZ,
    currentContainerId: board.currentContainerId,
  }
}

/**
 * Create a note (textcard by default) or free text.
 * Idempotent when `clientRequestId` already exists.
 */
export function createNote(
  board: BoardView,
  input: CreateNoteInput,
  options?: WriteOptions,
): BoardMutationResult {
  const dryRun = options?.dryRun === true
  const containerId = assertContainer(board, input.containerId)

  if (input.clientRequestId) {
    const existing = board.items.find((i) => i.id === input.clientRequestId)
    if (existing) {
      return {
        board: cloneView(board),
        createdIds: [],
        changedIds: [existing.id],
        dryRun,
      }
    }
  }

  const next = cloneView(board)
  const z = next.nextZ
  const id = input.clientRequestId || uid(input.kind === 'text' ? 'text' : 'note')
  const content = input.content ?? ''
  const kind = input.kind ?? 'textcard'

  let item: CanvasItem
  if (kind === 'text') {
    const t: TextItem = {
      id,
      type: 'text',
      x: input.x,
      y: input.y,
      width: input.width ?? 240,
      height: input.height ?? 48,
      rotation: 0,
      zIndex: z,
      content,
      fontSize: 18,
      fontFamily: FONT_STACKS[0]?.value ?? 'system-ui, sans-serif',
      fontWeight: 500,
      color: '#1e1e1e',
      backgroundColor: 'transparent',
    }
    item = tagContainerId(t, containerId)
  } else {
    const c: TextCardItem = {
      id,
      type: 'textcard',
      x: input.x,
      y: input.y,
      width: input.width ?? 240,
      height: input.height ?? 160,
      rotation: 0,
      zIndex: z,
      content,
      fontSize: 14,
      color: '#6b6b6b',
      backgroundColor: '#ffffff',
      labelColor: '#8c8c8c',
      labelBackground: 'transparent',
    }
    item = tagContainerId(c, containerId)
  }

  next.items = [...next.items, item]
  next.nextZ = z + 1

  return {
    board: next,
    createdIds: [id],
    changedIds: [id],
    dryRun,
  }
}

/** Whitelisted text / textcard / size updates. */
export function updateText(
  board: BoardView,
  input: UpdateTextInput,
  options?: WriteOptions,
): BoardMutationResult {
  const dryRun = options?.dryRun === true
  const idx = board.items.findIndex((i) => i.id === input.id)
  if (idx < 0) {
    throw new BoardOpsError(
      'ITEM_NOT_FOUND',
      `Item not found: ${input.id}`,
      input.id,
    )
  }
  const prev = board.items[idx]
  if (prev.type !== 'text' && prev.type !== 'textcard') {
    throw new BoardOpsError(
      'INVALID_PATCH',
      `updateText only supports text/textcard (got ${prev.type})`,
      prev.type,
    )
  }

  const patch: {
    content?: string
    color?: string
    backgroundColor?: string
    fontSize?: number
    width?: number
    height?: number
  } = {}
  if (input.content !== undefined) patch.content = input.content
  if (input.color !== undefined) patch.color = input.color
  if (input.backgroundColor !== undefined) {
    patch.backgroundColor = input.backgroundColor
  }
  if (input.fontSize !== undefined) {
    if (input.fontSize < 8 || input.fontSize > 200) {
      throw new BoardOpsError(
        'INVALID_PATCH',
        'fontSize out of range (8–200)',
        String(input.fontSize),
      )
    }
    patch.fontSize = input.fontSize
  }
  if (input.width !== undefined) patch.width = Math.max(24, input.width)
  if (input.height !== undefined) patch.height = Math.max(24, input.height)

  if (Object.keys(patch).length === 0) {
    return {
      board: cloneView(board),
      createdIds: [],
      changedIds: [],
      dryRun,
    }
  }

  const next = cloneView(board)
  next.items = next.items.map((it, i) => {
    if (i !== idx) return it
    return { ...it, ...patch } as CanvasItem
  })

  return {
    board: next,
    createdIds: [],
    changedIds: [input.id],
    dryRun,
  }
}

/**
 * Move free items by absolute pose fields.
 * Does not move stack folders in v1 (use a dedicated op later).
 */
export function moveItems(
  board: BoardView,
  input: MoveItemsInput,
  options?: WriteOptions,
): BoardMutationResult {
  const dryRun = options?.dryRun === true
  if (!input.moves?.length) {
    return {
      board: cloneView(board),
      createdIds: [],
      changedIds: [],
      dryRun,
    }
  }

  const byId = new Map(input.moves.map((m) => [m.id, m]))
  const changedIds: string[] = []
  const next = cloneView(board)

  next.items = next.items.map((item) => {
    const m = byId.get(item.id)
    if (!m) return item
    if (item.locked) {
      throw new BoardOpsError(
        'WRITE_DENIED',
        `Item is locked: ${item.id}`,
        item.id,
      )
    }
    const patch: Partial<CanvasItem> = {}
    if (m.x !== undefined) patch.x = m.x
    if (m.y !== undefined) patch.y = m.y
    if (m.rotation !== undefined) patch.rotation = m.rotation
    if (Object.keys(patch).length === 0) return item
    changedIds.push(item.id)
    return { ...item, ...patch } as CanvasItem
  })

  for (const m of input.moves) {
    if (!board.items.some((i) => i.id === m.id)) {
      throw new BoardOpsError(
        'ITEM_NOT_FOUND',
        `Item not found: ${m.id}`,
        m.id,
      )
    }
  }

  return {
    board: next,
    createdIds: [],
    changedIds,
    dryRun,
  }
}

/**
 * Apply multiple note creates as one mutation (single undo unit when live).
 */
export function createNotesBatch(
  board: BoardView,
  notes: CreateNoteInput[],
  options?: WriteOptions,
): BoardMutationResult {
  let cur = board
  const createdIds: string[] = []
  const changedIds: string[] = []
  const dryRun = options?.dryRun === true

  for (const n of notes) {
    const r = createNote(cur, n, { dryRun: false })
    cur = r.board
    createdIds.push(...r.createdIds)
    changedIds.push(...r.changedIds)
  }

  return { board: cur, createdIds, changedIds, dryRun }
}

/** Helper: items currently in a container (for tests / agents). */
export function itemsInBoardContainer(
  board: BoardView,
  containerId: string,
): CanvasItem[] {
  const cid = normalizeContainerId(containerId)
  return board.items.filter((i) => containerOf(i) === cid)
}
