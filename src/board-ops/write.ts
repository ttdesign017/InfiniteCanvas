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
  NoteRole,
  UpdateTextInput,
  WriteOptions,
} from './types'

const ROLE_PRESETS: Record<
  NoteRole,
  {
    kind: 'text' | 'textcard'
    fontSize: number
    fontWeight: number
    width: number
    height: number
    color: string
  }
> = {
  title: {
    kind: 'text',
    fontSize: 64,
    fontWeight: 700,
    width: 640,
    height: 88,
    color: '#1a1a1a',
  },
  subtitle: {
    kind: 'text',
    fontSize: 36,
    fontWeight: 650,
    width: 480,
    height: 56,
    color: '#2a2a2a',
  },
  keyword: {
    kind: 'text',
    fontSize: 40,
    fontWeight: 650,
    width: 280,
    height: 56,
    color: '#1a1a1a',
  },
  body: {
    kind: 'textcard',
    fontSize: 15,
    fontWeight: 400,
    width: 320,
    height: 140,
    color: '#4a4a4a',
  },
}

function clampFontSize(n: number): number {
  if (n < 8 || n > 200) {
    throw new BoardOpsError(
      'INVALID_PATCH',
      'fontSize out of range (8–200)',
      String(n),
    )
  }
  return n
}

/** Fullwidth / CJK / emoji ≈ 1em; Latin ≈ 0.58em. */
export function measureTextUnits(text: string): number {
  let u = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f) {
      /* control */
    } else if (
      (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0x9fff) || // CJK
      (code >= 0xa960 && code <= 0xa97f) ||
      (code >= 0xac00 && code <= 0xd7af) || // Hangul syllables
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe1f) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xffef) || // fullwidth
      (code >= 0x1f300 && code <= 0x1faff) // emoji
    ) {
      u += 1
    } else {
      u += 0.58
    }
  }
  return u
}

/**
 * Pull a hex color from content for swatch-style keywords
 * e.g. "#1D1D1B ONYX" → "#1D1D1B"
 */
export function extractHexColor(content: string): string | undefined {
  const m = content.match(/#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/)
  if (!m) return undefined
  let hex = m[1]
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (hex.length === 8) hex = hex.slice(0, 6)
  return `#${hex.toUpperCase()}`
}

/**
 * Pure text-block size estimate (no DOM). CJK-aware.
 * Floating text prefers single-line width so words are not clipped by wrap.
 */
export function estimateTextBlockSize(
  content: string,
  fontSize: number,
  opts?: {
    maxWidth?: number
    minWidth?: number
    minHeight?: number
    maxHeight?: number
    paddingX?: number
    paddingY?: number
    /** Extra chrome for textcard label row */
    chromeY?: number
    /**
     * Prefer expanding width (single line) when content fits under maxWidth.
     * Default true for short labels; set false for body paragraphs.
     */
    preferSingleLine?: boolean
    /** Multiplier on measured height (safety vs real font metrics) */
    heightFudge?: number
  },
): { width: number; height: number } {
  const text = content || ' '
  const maxWidth = opts?.maxWidth ?? 420
  const minWidth = opts?.minWidth ?? 64
  const minHeight = opts?.minHeight ?? 36
  const maxHeight = opts?.maxHeight ?? 1400
  const padX = opts?.paddingX ?? 20
  const padY = opts?.paddingY ?? 16
  const chromeY = opts?.chromeY ?? 0
  const preferSingleLine = opts?.preferSingleLine !== false
  const heightFudge = opts?.heightFudge ?? 1.18
  const em = Math.max(8, fontSize)

  const paragraphs = text.split(/\r?\n/)
  let longestUnits = 0
  let totalUnits = 0
  for (const para of paragraphs) {
    const u = para.length === 0 ? 0.01 : measureTextUnits(para)
    longestUnits = Math.max(longestUnits, u)
    totalUnits += u
  }

  const singleLineW = Math.ceil(longestUnits * em + padX * 2)

  // Short labels: grow width, avoid wrap so nothing is clipped
  if (preferSingleLine && singleLineW <= maxWidth) {
    const width = Math.min(maxWidth, Math.max(minWidth, singleLineW + 4))
    const lines = Math.max(1, paragraphs.length)
    const height = Math.min(
      maxHeight,
      Math.max(
        minHeight,
        Math.ceil((padY * 2 + chromeY + lines * em * 1.4) * heightFudge),
      ),
    )
    return { width, height }
  }

  const innerMax = Math.max(40, maxWidth - padX * 2)
  const unitsPerLine = Math.max(2, innerMax / em)
  let lines = 0
  for (const para of paragraphs) {
    const u = para.length === 0 ? 0.01 : measureTextUnits(para)
    lines += Math.max(1, Math.ceil(u / unitsPerLine))
  }
  lines = Math.max(1, lines)

  // Prefer a natural width for medium-length notes (not always maxWidth)
  const naturalW = Math.ceil(Math.min(longestUnits, unitsPerLine) * em + padX * 2)
  const width = Math.min(maxWidth, Math.max(minWidth, naturalW))
  const lineH = em * 1.5
  const height = Math.min(
    maxHeight,
    Math.max(
      minHeight,
      Math.ceil((padY * 2 + chromeY + lines * lineH) * heightFudge),
    ),
  )
  return { width, height }
}

/** Resolve kind / size / weight from role + explicit overrides. */
export function resolveNoteStyle(input: CreateNoteInput): {
  kind: 'text' | 'textcard'
  fontSize: number
  fontWeight: number
  width: number
  height: number
  color: string
} {
  const role = input.role
  const preset = role ? ROLE_PRESETS[role] : null
  const kind =
    input.kind ??
    (preset ? preset.kind : 'textcard')
  const base =
    preset ??
    (kind === 'text'
      ? {
          kind: 'text' as const,
          fontSize: 18,
          fontWeight: 500,
          width: 240,
          height: 48,
          color: '#1e1e1e',
        }
      : {
          kind: 'textcard' as const,
          fontSize: 14,
          fontWeight: 400,
          width: 300,
          height: 140,
          color: '#4a4a4a',
        })

  const fontSize =
    input.fontSize !== undefined
      ? clampFontSize(input.fontSize)
      : base.fontSize

  const content = input.content ?? ''
  const autoColor = extractHexColor(content)
  const color = input.color ?? autoColor ?? base.color

  const autoSize = input.autoSize !== false
  let width = input.width
  let height = input.height

  if (autoSize && (width === undefined || height === undefined)) {
    if (kind === 'text') {
      // Wide single-line budget so bold titles/keywords are not forced to wrap
      const maxW =
        role === 'title'
          ? 1400
          : role === 'subtitle'
            ? 1000
            : role === 'keyword'
              ? 900
              : 900
      const measured = estimateTextBlockSize(content, fontSize, {
        maxWidth: maxW,
        minWidth: role === 'keyword' ? 56 : 120,
        minHeight: Math.ceil(fontSize * 1.35),
        maxHeight: 520,
        paddingX: 10,
        paddingY: 8,
        chromeY: 0,
        preferSingleLine: true,
        heightFudge: 1.14,
      })
      width = width ?? measured.width
      height = height ?? measured.height
    } else {
      // Note cards: width follows content (short = narrow, long = wrap & grow)
      const units = measureTextUnits(content)
      const softMax = units < 40 ? 280 : units < 120 ? 360 : 420
      const measured = estimateTextBlockSize(content, fontSize, {
        maxWidth: softMax,
        minWidth: 150,
        minHeight: 100,
        maxHeight: 1600,
        paddingX: 16,
        paddingY: 14,
        chromeY: 32,
        preferSingleLine: false,
        heightFudge: 1.22,
      })
      width = width ?? measured.width
      height = height ?? measured.height
    }
  }

  return {
    kind,
    fontSize,
    fontWeight: input.fontWeight ?? base.fontWeight,
    width: width ?? base.width,
    height: height ?? base.height,
    color,
  }
}

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
  const content = input.content ?? ''
  const style = resolveNoteStyle(input)
  const kind = style.kind
  const id = input.clientRequestId || uid(kind === 'text' ? 'text' : 'note')

  let item: CanvasItem
  if (kind === 'text') {
    const t: TextItem = {
      id,
      type: 'text',
      x: input.x,
      y: input.y,
      width: style.width,
      height: style.height,
      rotation: 0,
      zIndex: z,
      content,
      fontSize: style.fontSize,
      fontFamily: FONT_STACKS[0]?.value ?? 'system-ui, sans-serif',
      fontWeight: style.fontWeight,
      color: style.color,
      backgroundColor: 'transparent',
    }
    item = tagContainerId(t, containerId)
  } else {
    const c: TextCardItem = {
      id,
      type: 'textcard',
      x: input.x,
      y: input.y,
      width: style.width,
      height: style.height,
      rotation: 0,
      zIndex: z,
      content,
      fontSize: style.fontSize,
      color: style.color,
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
