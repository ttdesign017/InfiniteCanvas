/**
 * Extended writes: links, stacks, images, layout, research cluster.
 */

import type {
  CanvasItem,
  LinkCardItem,
  MediaItem,
  StackRecord,
} from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { uid } from '../utils/id'
import { containerOf } from '../utils/stacks'
import { BoardOpsError } from './errors'
import type {
  BoardMutationResult,
  BoardView,
  CreateNoteInput,
  WriteOptions,
} from './types'
import { createNote } from './write'
import type {
  CreateImageInput,
  CreateLinkInput,
  CreateStackInput,
  LayoutGridInput,
  MoveToContainerInput,
  ResearchClusterInput,
} from './agentProtocol'

function normalizeContainerId(id: string | undefined): string {
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

function tagContainerId(item: CanvasItem, containerId: string): CanvasItem {
  if (containerId === ROOT_CONTAINER_ID) {
    if (!item.containerId || item.containerId === ROOT_CONTAINER_ID) return item
    const { containerId: _c, ...rest } = item
    return rest as CanvasItem
  }
  return { ...item, containerId }
}

function normalizeUrl(url: string): string {
  const t = url.trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function createLink(
  board: BoardView,
  input: CreateLinkInput,
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
  const url = normalizeUrl(input.url)
  if (!url) {
    throw new BoardOpsError('INVALID_PATCH', 'url is required')
  }
  const next = cloneView(board)
  const z = next.nextZ
  const id = input.clientRequestId || uid('link')
  const titleIn = input.title?.trim()
  const descIn = input.description?.trim()
  // When the agent supplies a title, mark preview complete so LinkCardView
  // does not overwrite it with remote OG metadata.
  const titleLocked = Boolean(titleIn)
  const item: LinkCardItem = tagContainerId(
    {
      id,
      type: 'link',
      x: input.x,
      y: input.y,
      width: input.width ?? 476,
      height: input.height ?? 160,
      rotation: 0,
      zIndex: z,
      url,
      title: titleIn || hostOf(url),
      description: descIn || hostOf(url),
      previewStatus: titleLocked ? 'complete' : 'pending',
    },
    containerId,
  ) as LinkCardItem
  next.items = [...next.items, item]
  next.nextZ = z + 1
  return { board: next, createdIds: [id], changedIds: [id], dryRun }
}

export function createStack(
  board: BoardView,
  input: CreateStackInput,
  options?: WriteOptions,
): BoardMutationResult {
  const dryRun = options?.dryRun === true
  const parentId = assertContainer(board, input.parentId)
  if (input.clientRequestId) {
    const existing = board.stacks.find((s) => s.id === input.clientRequestId)
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
  const id = input.clientRequestId || uid('stack')
  const st: StackRecord = {
    id,
    parentId,
    name: (input.name || '').trim(),
    x: input.x,
    y: input.y,
    width: input.width ?? 280,
    height: input.height ?? 220,
    zIndex: z,
  }
  next.stacks = [...next.stacks, st]
  next.nextZ = z + 1
  return {
    board: next,
    createdIds: [],
    createdStackIds: [id],
    changedIds: [id],
    dryRun,
    stackId: id,
  }
}

export function renameStack(
  board: BoardView,
  id: string,
  name: string,
  options?: WriteOptions,
): BoardMutationResult {
  const dryRun = options?.dryRun === true
  const st = board.stacks.find((s) => s.id === id)
  if (!st) {
    throw new BoardOpsError('STACK_NOT_FOUND', `Stack not found: ${id}`, id)
  }
  const next = cloneView(board)
  next.stacks = next.stacks.map((s) =>
    s.id === id ? { ...s, name: name.trim() } : s,
  )
  return { board: next, createdIds: [], changedIds: [id], dryRun }
}

export function moveToContainer(
  board: BoardView,
  input: MoveToContainerInput,
  options?: WriteOptions,
): BoardMutationResult {
  const dryRun = options?.dryRun === true
  const containerId = assertContainer(board, input.containerId)
  const idSet = new Set(input.itemIds)
  const layout = new Map(
    (input.layout || []).map((l) => [l.id, l] as const),
  )
  for (const id of idSet) {
    if (!board.items.some((i) => i.id === id)) {
      throw new BoardOpsError('ITEM_NOT_FOUND', `Item not found: ${id}`, id)
    }
  }
  const next = cloneView(board)
  const changedIds: string[] = []
  next.items = next.items.map((item) => {
    if (!idSet.has(item.id)) return item
    changedIds.push(item.id)
    let tagged = tagContainerId(item, containerId)
    const pose = layout.get(item.id)
    if (pose) tagged = { ...tagged, x: pose.x, y: pose.y }
    return tagged
  })
  return { board: next, createdIds: [], changedIds, dryRun }
}

export function layoutGrid(
  board: BoardView,
  input: LayoutGridInput,
  options?: WriteOptions,
): BoardMutationResult {
  const dryRun = options?.dryRun === true
  const cols = Math.max(1, input.columns ?? 3)
  const gapX = input.gapX ?? 24
  const gapY = input.gapY ?? 24
  const cellW = input.cellWidth ?? 240
  const cellH = input.cellHeight ?? 180
  const ids = input.itemIds
  for (const id of ids) {
    if (!board.items.some((i) => i.id === id)) {
      throw new BoardOpsError('ITEM_NOT_FOUND', `Item not found: ${id}`, id)
    }
  }
  const next = cloneView(board)
  const pos = new Map<string, { x: number; y: number }>()
  ids.forEach((id, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    pos.set(id, {
      x: input.originX + col * (cellW + gapX),
      y: input.originY + row * (cellH + gapY),
    })
  })
  const changedIds: string[] = []
  next.items = next.items.map((item) => {
    const p = pos.get(item.id)
    if (!p) return item
    changedIds.push(item.id)
    return {
      ...item,
      x: p.x,
      y: p.y,
      width: item.width || cellW,
      height: item.height || cellH,
    }
  })
  return { board: next, createdIds: [], changedIds, dryRun }
}

export function createImage(
  board: BoardView,
  input: CreateImageInput,
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
  if (!input.src) {
    throw new BoardOpsError('INVALID_PATCH', 'src is required for createImage')
  }
  const next = cloneView(board)
  const z = next.nextZ
  const id = input.clientRequestId || uid('image')
  const nw = input.naturalWidth ?? input.width ?? 320
  const nh = input.naturalHeight ?? input.height ?? 240
  const w = input.width ?? Math.min(360, nw)
  const h = input.height ?? Math.round((w * nh) / Math.max(1, nw))
  const item: MediaItem = tagContainerId(
    {
      id,
      type: 'image',
      x: input.x,
      y: input.y,
      width: w,
      height: h,
      rotation: 0,
      zIndex: z,
      src: input.src,
      fileName: input.fileName,
      naturalWidth: nw,
      naturalHeight: nh,
    },
    containerId,
  ) as MediaItem
  next.items = [...next.items, item]
  next.nextZ = z + 1
  return { board: next, createdIds: [id], changedIds: [id], dryRun }
}

/**
 * Create a named stack and fill it with notes/links/images in a grid.
 * One mutation = one undo unit when applied live.
 */
export function addResearchCluster(
  board: BoardView,
  input: ResearchClusterInput,
  options?: WriteOptions,
): BoardMutationResult & { stackId?: string; itemIds?: string[] } {
  const dryRun = options?.dryRun === true || input.dryRun === true
  const parentId = assertContainer(board, input.parentId ?? ROOT_CONTAINER_ID)
  const originX = input.x ?? 80
  const originY = input.y ?? 80
  const columns = Math.max(1, input.columns ?? 3)
  const warnings: string[] = []

  // Idempotent full cluster when clientRequestId already exists as a stack
  if (input.clientRequestId) {
    const existing = board.stacks.find((s) => s.id === input.clientRequestId)
    if (existing) {
      const itemIds = board.items
        .filter((i) => containerOf(i) === existing.id)
        .map((i) => i.id)
      return {
        board: cloneView(board),
        createdIds: [],
        createdStackIds: [],
        changedIds: [existing.id],
        dryRun,
        stackId: existing.id,
        itemIds,
        warnings: ['idempotent: stack clientRequestId already exists'],
      }
    }
  }

  let cur = board
  const allCreated: string[] = []
  const allStackIds: string[] = []
  const allChanged: string[] = []

  const stackRes = createStack(
    cur,
    {
      parentId,
      x: originX,
      y: originY,
      name: input.title,
      width: 320,
      height: 260,
      clientRequestId: input.clientRequestId,
    },
    { dryRun: false },
  )
  cur = stackRes.board
  allCreated.push(...stackRes.createdIds)
  allStackIds.push(...(stackRes.createdStackIds ?? []))
  allChanged.push(...stackRes.changedIds)
  const stackId = stackRes.createdStackIds?.[0] ?? stackRes.stackId
  if (!stackId) {
    throw new BoardOpsError('INTERNAL', 'Failed to create research stack')
  }

  const itemIds: string[] = []
  let slot = 0
  const place = () => {
    const col = slot % columns
    const row = Math.floor(slot / columns)
    slot += 1
    return {
      x: 24 + col * 280,
      y: 24 + row * 200,
    }
  }

  for (const n of input.notes || []) {
    const p = place()
    const r = createNote(
      cur,
      {
        containerId: stackId,
        x: p.x,
        y: p.y,
        content: n.content,
        kind: n.kind ?? 'textcard',
      } satisfies CreateNoteInput,
      { dryRun: false },
    )
    cur = r.board
    allCreated.push(...r.createdIds)
    allChanged.push(...r.changedIds)
    itemIds.push(...r.createdIds)
  }

  for (const l of input.links || []) {
    const p = place()
    const r = createLink(
      cur,
      {
        containerId: stackId,
        x: p.x,
        y: p.y,
        url: l.url,
        title: l.title,
        description: l.description,
      },
      { dryRun: false },
    )
    cur = r.board
    allCreated.push(...r.createdIds)
    allChanged.push(...r.changedIds)
    itemIds.push(...r.createdIds)
  }

  for (const img of input.images || []) {
    const src = img.dataUrl
    if (!src) {
      // URL-only must be resolved by MCP prepareOp; if still missing, skip
      warnings.push(
        `image skipped (no dataUrl): ${img.url || img.fileName || 'unknown'}`,
      )
      continue
    }
    try {
      const p = place()
      const r = createImage(
        cur,
        {
          containerId: stackId,
          x: p.x,
          y: p.y,
          src,
          fileName: img.fileName || 'image',
          width: 260,
          height: 180,
        },
        { dryRun: false },
      )
      cur = r.board
      allCreated.push(...r.createdIds)
      allChanged.push(...r.changedIds)
      itemIds.push(...r.createdIds)
    } catch (err) {
      warnings.push(
        `image failed: ${img.fileName || img.url || 'unknown'} (${err instanceof Error ? err.message : String(err)})`,
      )
    }
  }

  // Resize stack folder to fit content roughly
  const cols = Math.min(columns, Math.max(1, itemIds.length))
  const rows = Math.max(1, Math.ceil(itemIds.length / columns))
  cur = {
    ...cur,
    stacks: cur.stacks.map((s) =>
      s.id === stackId
        ? {
            ...s,
            width: Math.max(280, cols * 280 + 48),
            height: Math.max(220, rows * 200 + 48),
          }
        : s,
    ),
  }

  // Read-after-write: stack + all children must exist on resulting board
  if (!cur.stacks.some((s) => s.id === stackId)) {
    throw new BoardOpsError(
      'INTERNAL',
      'Research cluster stack missing after write',
      stackId,
    )
  }
  for (const id of itemIds) {
    if (!cur.items.some((i) => i.id === id)) {
      throw new BoardOpsError(
        'INTERNAL',
        'Research cluster item missing after write',
        id,
      )
    }
  }

  return {
    board: cur,
    createdIds: allCreated,
    createdStackIds: allStackIds.length ? allStackIds : [stackId],
    changedIds: allChanged,
    dryRun,
    stackId,
    itemIds,
    warnings: warnings.length ? warnings : undefined,
  }
}

export function worldRectFromViewport(
  viewport: { x: number; y: number; zoom: number },
  screenW: number,
  screenH: number,
) {
  const z = Math.max(0.05, viewport.zoom)
  return {
    x: (0 - viewport.x) / z,
    y: (0 - viewport.y) / z,
    width: screenW / z,
    height: screenH / z,
  }
}
