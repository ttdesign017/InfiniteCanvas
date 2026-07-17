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
import {
  createNote,
  estimateTextBlockSize,
  extractHexColor,
  resolveNoteStyle,
} from './write'
import type {
  CreateImageInput,
  CreateLinkInput,
  CreateStackInput,
  LayoutGridInput,
  MoveToContainerInput,
  ResearchClusterImage,
  ResearchClusterInput,
  ResearchClusterLink,
  ResearchClusterNote,
} from './agentProtocol'
import {
  compactNestedFanAt,
  freeFanRelFromLocalFan,
} from '../utils/stacks'

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
  // Default: leave pending so LinkCardView fetches real OG title/image/favicon.
  // Only lock when caller explicitly wants a fixed title (rare for agents).
  const titleLocked = input.lockTitle === true && Boolean(titleIn)
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
  const nw = input.naturalWidth ?? input.width ?? 640
  const nh = input.naturalHeight ?? input.height ?? 480
  // Prefer readable display size (mood boards); still cap for huge assets
  const maxW = 560
  const w = input.width ?? Math.min(maxW, Math.max(280, nw > maxW ? maxW : nw))
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

/** Heuristic: URL looks like a direct image asset (should use images[], not links[]). */
export function looksLikeImageUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const path = u.pathname.toLowerCase()
    if (/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)(\?|$)/i.test(path)) return true
    // common CDN image query patterns
    if (/[?&](format|fm)=(jpg|jpeg|png|webp)/i.test(u.search)) return true
    return false
  } catch {
    return /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(url)
  }
}

/**
 * Seed parent-canvas fan previews for a stack that was filled without
 * enter/exit (agent writes). Without this, collapsed folders show empty chrome.
 */
export function seedStackFanPreview(
  board: BoardView,
  stackId: string,
): BoardView {
  const stack = board.stacks.find((s) => s.id === stackId)
  if (!stack) return board
  const members = board.items.filter((i) => containerOf(i) === stackId)
  if (members.length === 0) return board

  const { cards, bounds } = compactNestedFanAt(
    { x: stack.x, y: stack.y },
    members.map((m) => ({
      id: m.id,
      width: m.width,
      height: m.height,
      zIndex: m.zIndex,
    })),
  )
  const byId = new Map(cards.map((c) => [c.id, c]))
  const freeFanRel = freeFanRelFromLocalFan(
    cards.map((c) => ({
      id: c.id,
      x: c.x - stack.x,
      y: c.y - stack.y,
      rotation: c.rotation,
    })),
  )

  return {
    ...board,
    items: board.items.map((item) => {
      const c = byId.get(item.id)
      if (!c) return item
      return {
        ...item,
        stackPreview: {
          x: c.x,
          y: c.y,
          rotation: c.rotation,
        },
      }
    }),
    stacks: board.stacks.map((s) =>
      s.id === stackId
        ? {
            ...s,
            freeFanRel,
            width: Math.max(s.width, bounds.width),
            height: Math.max(s.height, bounds.height),
          }
        : s,
    ),
  }
}

type SizedRect = { x: number; y: number; width: number; height: number }

function noteBox(n: ResearchClusterNote): { width: number; height: number } {
  const style = resolveNoteStyle({
    containerId: 'root',
    x: 0,
    y: 0,
    content: n.content,
    kind: n.kind,
    role: n.role,
    fontSize: n.fontSize,
    color: n.color,
    fontWeight: n.fontWeight,
    width: n.width,
    height: n.height,
    autoSize: n.autoSize,
  })
  return { width: style.width, height: style.height }
}

function imageBox(img: ResearchClusterImage): { width: number; height: number } {
  const nw = img.naturalWidth ?? 640
  const nh = img.naturalHeight ?? 480
  const maxW = img.width ?? 480
  const w = Math.min(maxW, Math.max(300, nw > maxW ? maxW : nw))
  const h = Math.round((w * nh) / Math.max(1, nw))
  return { width: w, height: Math.min(h, 420) }
}

const LINK_W = 476
const LINK_H = 160

function annotationBox(text: string): { width: number; height: number } {
  return estimateTextBlockSize(text, 15, {
    maxWidth: LINK_W,
    minWidth: 120,
    minHeight: 22,
    paddingX: 2,
    paddingY: 2,
  })
}

/**
 * Create or **append** a research / mood cluster.
 *
 * Progressive streaming:
 * - First call: create stack (`title` + optional `clientRequestId`).
 * - Later calls: pass `stackId` (or the same `clientRequestId`) with new
 *   `sections` / notes / images — content is placed **below** existing items
 *   and applied live immediately (one MCP call = one visible chunk).
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
  const layoutMode = input.layout ?? 'mood'
  const columns = Math.max(1, input.columns ?? (layoutMode === 'grid' ? 3 : 2))
  const warnings: string[] = []
  const enterStack = input.enterStack !== false
  const appendGap = input.appendGap ?? 80

  const allLinks = [
    ...(input.links || []),
    ...((input.sections || []).flatMap((s) => s.links || [])),
  ]
  for (const l of allLinks) {
    if (looksLikeImageUrl(l.url)) {
      warnings.push(
        `link looks like an image URL — prefer images[] for true media: ${l.url}`,
      )
    }
  }

  // Reuse clientRequestId as progressive stack id (append, not no-op)
  let resolvedStackId = input.stackId
  if (!resolvedStackId && input.clientRequestId) {
    const existing = board.stacks.find((s) => s.id === input.clientRequestId)
    if (existing) resolvedStackId = existing.id
  }

  let cur = board
  const allCreated: string[] = []
  const allStackIds: string[] = []
  const allChanged: string[] = []
  let stackId: string
  let contentStartY = layoutMode === 'grid' ? 24 : 48
  let isAppend = false

  if (resolvedStackId) {
    assertContainer(board, resolvedStackId)
    stackId = resolvedStackId
    isAppend = true
    const members = board.items.filter((i) => containerOf(i) === stackId)
    if (members.length > 0) {
      let maxB = 0
      for (const m of members) {
        maxB = Math.max(maxB, m.y + m.height)
      }
      contentStartY = maxB + appendGap
    }
    // Optional rename on append
    if (input.title?.trim()) {
      const name = input.title.trim()
      cur = {
        ...cur,
        stacks: cur.stacks.map((s) =>
          s.id === stackId ? { ...s, name } : s,
        ),
      }
      allChanged.push(stackId)
    }
  } else {
    const title = (input.title || '').trim() || 'Board'
    const stackRes = createStack(
      cur,
      {
        parentId,
        x: originX,
        y: originY,
        name: title,
        width: 360,
        height: 280,
        clientRequestId: input.clientRequestId,
      },
      { dryRun: false },
    )
    cur = stackRes.board
    allCreated.push(...stackRes.createdIds)
    allStackIds.push(...(stackRes.createdStackIds ?? []))
    allChanged.push(...stackRes.changedIds)
    const sid = stackRes.createdStackIds?.[0] ?? stackRes.stackId
    if (!sid) {
      throw new BoardOpsError('INTERNAL', 'Failed to create research stack')
    }
    stackId = sid
  }

  // Empty shell: just open stack (progressive begin)
  const hasContent =
    (input.notes && input.notes.length > 0) ||
    (input.links && input.links.length > 0) ||
    (input.images && input.images.length > 0) ||
    (input.sections && input.sections.length > 0)

  if (!hasContent) {
    cur = seedStackFanPreview(cur, stackId)
    return {
      board: cur,
      createdIds: allCreated,
      createdStackIds: allStackIds.length ? allStackIds : isAppend ? [] : [stackId],
      changedIds: allChanged.length ? allChanged : [stackId],
      dryRun,
      stackId,
      itemIds: [],
      warnings: isAppend
        ? ['append: no new content']
        : ['opened empty stack — append sections next'],
      enterContainerId: enterStack ? stackId : undefined,
      fitViewport: enterStack,
    }
  }

  const itemIds: string[] = []

  type PlaceJob =
    | { kind: 'note'; note: ResearchClusterNote; pos: SizedRect }
    | {
        kind: 'link'
        link: ResearchClusterLink
        pos: SizedRect
        ann?: { text: string; pos: SizedRect }
      }
    | {
        kind: 'image'
        image: ResearchClusterImage
        pos: SizedRect
        caption?: { text: string; pos: SizedRect }
      }

  const jobs: PlaceJob[] = []

  if (layoutMode === 'grid') {
    let slot = 0
    const place = () => {
      const col = slot % columns
      const row = Math.floor(slot / columns)
      slot += 1
      return {
        x: 24 + col * 300,
        y: contentStartY + row * 220,
        width: 280,
        height: 200,
      }
    }
    for (const n of input.notes || []) {
      const box = noteBox(n)
      const p = place()
      jobs.push({
        kind: 'note',
        note: n,
        pos: { x: p.x, y: p.y, width: box.width, height: box.height },
      })
    }
    for (const l of input.links || []) {
      const p = place()
      const annText = (l.annotation || l.title || '').trim()
      if (annText) {
        const ab = annotationBox(annText)
        jobs.push({
          kind: 'link',
          link: l,
          ann: {
            text: annText,
            pos: {
              x: p.x,
              y: p.y,
              width: ab.width,
              height: ab.height,
            },
          },
          pos: {
            x: p.x,
            y: p.y + ab.height + 6,
            width: LINK_W,
            height: LINK_H,
          },
        })
      } else {
        jobs.push({
          kind: 'link',
          link: l,
          pos: { x: p.x, y: p.y, width: LINK_W, height: LINK_H },
        })
      }
    }
    for (const img of input.images || []) {
      const box = imageBox(img)
      const p = place()
      jobs.push({
        kind: 'image',
        image: img,
        pos: { x: p.x, y: p.y, width: box.width, height: box.height },
      })
    }
  } else {
    // —— organic free-canvas layout (magazine / mood board) ——
    // Vertical section bands, strong alternating bias, loose L-composition,
    // larger jitter — readable but not a grid.
    const PAD = 56
    const SECTION_GAP = 110
    const SECTION_ACCENTS = [
      '#1D1D1B',
      '#5C4B3A',
      '#2F4A6E',
      '#6B3A3A',
      '#3D5A40',
      '#4A3F6B',
    ]

    type SectionBlock = {
      heading?: string
      accent: string
      titles: ResearchClusterNote[]
      keywords: ResearchClusterNote[]
      notes: ResearchClusterNote[]
      images: ResearchClusterImage[]
      links: ResearchClusterLink[]
    }

    const topTitles = (input.notes || []).filter((n) => n.role === 'title')
    const topSubtitles = (input.notes || []).filter((n) => n.role === 'subtitle')
    const topKeywords = (input.notes || []).filter((n) => n.role === 'keyword')
    const topBodies = (input.notes || []).filter(
      (n) => !n.role || n.role === 'body',
    )
    const topImages = [...(input.images || [])]
    const topLinks = [...(input.links || [])]

    const sections: SectionBlock[] = []

    if (input.sections?.length) {
      input.sections.forEach((sec, i) => {
        const notes = sec.notes || []
        sections.push({
          heading: sec.heading,
          accent: SECTION_ACCENTS[i % SECTION_ACCENTS.length],
          titles: notes.filter((n) => n.role === 'title'),
          keywords: notes.filter((n) => n.role === 'keyword'),
          notes: notes.filter((n) => !n.role || n.role === 'body' || n.role === 'subtitle'),
          images: sec.images || [],
          links: sec.links || [],
        })
      })
      // leftover top-level content → first section or new "概览"
      if (
        topTitles.length ||
        topKeywords.length ||
        topBodies.length ||
        topImages.length ||
        topLinks.length
      ) {
        sections.unshift({
          heading: undefined,
          accent: SECTION_ACCENTS[0],
          titles: topTitles,
          keywords: topKeywords,
          notes: [...topSubtitles, ...topBodies],
          images: topImages,
          links: topLinks,
        })
      }
    } else {
      // Synthesize 1 hero + thematic slices from groups / round-robin
      const byGroup = new Map<string, SectionBlock>()
      const ensure = (g: string, i: number): SectionBlock => {
        let s = byGroup.get(g)
        if (!s) {
          s = {
            heading: g,
            accent: SECTION_ACCENTS[i % SECTION_ACCENTS.length],
            titles: [],
            keywords: [],
            notes: [],
            images: [],
            links: [],
          }
          byGroup.set(g, s)
          sections.push(s)
        }
        return s
      }
      let gi = 0
      for (const n of topBodies) {
        if (n.group) ensure(n.group, gi++).notes.push(n)
      }
      for (const img of [...topImages]) {
        if (img.group) {
          ensure(img.group, gi++).images.push(img)
          const idx = topImages.indexOf(img)
          if (idx >= 0) topImages.splice(idx, 1)
        }
      }
      for (const l of [...topLinks]) {
        if (l.group) {
          ensure(l.group, gi++).links.push(l)
          const idx = topLinks.indexOf(l)
          if (idx >= 0) topLinks.splice(idx, 1)
        }
      }
      const ungroupedBodies = topBodies.filter((n) => !n.group)
      // Hero band: title + keywords + first body
      sections.unshift({
        heading: undefined,
        accent: SECTION_ACCENTS[0],
        titles: topTitles,
        keywords: topKeywords,
        notes: [
          ...topSubtitles,
          ...(ungroupedBodies.length ? [ungroupedBodies.shift()!] : []),
        ],
        images: topImages.splice(0, Math.min(2, topImages.length)),
        links: topLinks.splice(0, Math.min(1, topLinks.length)),
      })
      // Remaining as visual zones (not rigid columns)
      let slice = 0
      while (ungroupedBodies.length || topImages.length || topLinks.length) {
        sections.push({
          heading: ['观察', '视觉', '参考', '延伸'][slice % 4],
          accent: SECTION_ACCENTS[(slice + 1) % SECTION_ACCENTS.length],
          titles: [],
          keywords: [],
          notes: ungroupedBodies.splice(0, 1),
          images: topImages.splice(0, 2),
          links: topLinks.splice(0, 1),
        })
        slice++
      }
    }

    // When appending, continue below existing content (not from top PAD)
    let boardY = Math.max(PAD, contentStartY)
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si]
      if (
        !sec.titles.length &&
        !sec.keywords.length &&
        !sec.notes.length &&
        !sec.images.length &&
        !sec.links.length &&
        !sec.heading
      ) {
        continue
      }

      // Strong alternating bias + per-section fan-out (not twin columns)
      const biasLeft = si % 2 === 0
      const originX =
        PAD + (biasLeft ? 0 : 120 + (si % 2) * 40) + (si % 4) * 28
      const textRailW = 400 + (si % 3) * 24
      // Sometimes media starts closer / farther for irregular rhythm
      const mediaRailX =
        originX +
        textRailW +
        36 +
        (biasLeft ? 20 + (si % 3) * 16 : -48 - (si % 2) * 20)
      let y = boardY + (si % 3) * 12
      // Larger deterministic jitter — free canvas feel
      const jx = (n: number) => ((n * 23 + si * 19) % 49) - 24
      const jy = (n: number) => ((n * 17 + si * 11) % 37) - 18

      // Section heading (MD-like H2) — bold floating type
      if (sec.heading) {
        const headingNote: ResearchClusterNote = {
          content: sec.heading,
          role: 'subtitle',
          color: sec.accent,
          fontSize: 40,
          fontWeight: 700,
        }
        const box = noteBox(headingNote)
        jobs.push({
          kind: 'note',
          note: headingNote,
          pos: {
            x: originX + jx(0),
            y: y + jy(0),
            width: box.width,
            height: box.height,
          },
        })
        y += box.height + 22
      }

      // Titles in section — allow agent fontSize; default huge
      for (let i = 0; i < sec.titles.length; i++) {
        const n = {
          ...sec.titles[i],
          color: sec.titles[i].color || sec.accent,
          fontSize: sec.titles[i].fontSize ?? 64,
        }
        const box = noteBox(n)
        jobs.push({
          kind: 'note',
          note: n,
          pos: {
            x: originX + jx(i + 1),
            y: y + jy(i + 1),
            width: box.width,
            height: box.height,
          },
        })
        y += box.height + 16
      }

      // Keywords: free scatter cluster (not a perfect row)
      if (sec.keywords.length) {
        let kx = originX
        let rowY = y
        let rowH = 0
        const rowMax = originX + 1100
        for (let i = 0; i < sec.keywords.length; i++) {
          const raw = sec.keywords[i]
          const hex = extractHexColor(raw.content)
          // Importance cascade: first keywords larger if agent omitted fontSize
          const cascade =
            i === 0 ? 48 : i === 1 ? 42 : i === 2 ? 36 : 32
          const n: ResearchClusterNote = {
            ...raw,
            color: raw.color || hex || sec.accent,
            fontSize: raw.fontSize || (hex ? Math.max(32, cascade - 4) : cascade),
            fontWeight: raw.fontWeight || 650,
          }
          const box = noteBox(n)
          if (kx > originX && kx + box.width > rowMax) {
            y = rowY + rowH + 18
            rowY = y
            kx = originX + ((i * 31) % 48)
            rowH = 0
          }
          // Diagonal-ish scatter within the chip cluster
          const scatterX = jx(i + 3) + (i % 3) * 10
          const scatterY = jy(i + 5) + (i % 2) * 14 - (i % 3) * 6
          jobs.push({
            kind: 'note',
            note: n,
            pos: {
              x: kx + scatterX,
              y: rowY + scatterY,
              width: box.width,
              height: box.height,
            },
          })
          kx += box.width + 18 + (i % 2) * 12
          rowH = Math.max(rowH, box.height + Math.abs(scatterY) + 8)
        }
        y = rowY + rowH + 36
      }

      // Loose L: notes on text rail; images can spill / stagger heavily
      let textY = y
      let mediaY = y + (biasLeft ? 8 : 40)

      for (let i = 0; i < sec.notes.length; i++) {
        const n = sec.notes[i]
        const box = noteBox(n)
        // Alternate notes slightly into the media side for looser pack
        const drift =
          i % 3 === 2 ? Math.floor(textRailW * 0.15) : 0
        const xOff = (biasLeft ? 0 : 28) + jx(i) + drift
        jobs.push({
          kind: 'note',
          note: n,
          pos: {
            x: originX + xOff,
            y: textY + jy(i),
            width: box.width,
            height: box.height,
          },
        })
        textY += box.height + 20 + (i % 2) * 12
      }

      for (let i = 0; i < sec.images.length; i++) {
        const img = sec.images[i]
        const box = imageBox(img)
        // Strong stagger + occasional overlap into text band
        const staggerX = (i % 2) * 56 + (i % 3) * 18
        const staggerY = (i % 2) * 72 + (i % 3) * 20
        const pullLeft = !biasLeft && i === 0 ? -80 : 0
        jobs.push({
          kind: 'image',
          image: img,
          pos: {
            x: mediaRailX + staggerX + jx(i + 2) + pullLeft,
            y: mediaY + staggerY + jy(i + 2),
            width: box.width,
            height: box.height,
          },
        })
        if (img.caption?.trim()) {
          const cap: ResearchClusterNote = {
            content: img.caption.trim(),
            kind: 'text',
            fontSize: 14,
            color: '#666666',
          }
          const cb = noteBox(cap)
          jobs.push({
            kind: 'note',
            note: cap,
            pos: {
              x: mediaRailX + staggerX + pullLeft,
              y: mediaY + staggerY + box.height + 8,
              width: cb.width,
              height: cb.height,
            },
          })
          mediaY += box.height + cb.height + 36 + staggerY
        } else {
          mediaY += box.height + 32 + staggerY
        }
      }

      // Links sit under the taller rail, with side offset
      let linkY = Math.max(textY, mediaY) + 24
      const linkX = biasLeft
        ? originX + jx(9)
        : mediaRailX - 60 + jx(10)
      for (let i = 0; i < sec.links.length; i++) {
        const l = sec.links[i]
        const annText = (l.annotation || l.title || '').trim()
        if (annText) {
          const ab = annotationBox(annText)
          jobs.push({
            kind: 'link',
            link: l,
            ann: {
              text: annText,
              pos: {
                x: linkX + jx(i),
                y: linkY + jy(i),
                width: ab.width,
                height: ab.height,
              },
            },
            pos: {
              x: linkX + jx(i),
              y: linkY + ab.height + 10 + jy(i),
              width: LINK_W,
              height: LINK_H,
            },
          })
          linkY += ab.height + 10 + LINK_H + 36
        } else {
          jobs.push({
            kind: 'link',
            link: l,
            pos: {
              x: linkX + jx(i),
              y: linkY + jy(i),
              width: LINK_W,
              height: LINK_H,
            },
          })
          linkY += LINK_H + 36
        }
      }

      boardY = Math.max(textY, mediaY, linkY) + SECTION_GAP + (si % 2) * 20
    }
  }

  // Materialize jobs — re-run autoSize so boxes match CJK-aware measure
  // (layout uses the same noteBox/resolveNoteStyle for positions).
  for (const job of jobs) {
    if (job.kind === 'note') {
      const style = resolveNoteStyle({
        containerId: stackId,
        x: job.pos.x,
        y: job.pos.y,
        content: job.note.content,
        kind: job.note.kind,
        role: job.note.role,
        fontSize: job.note.fontSize,
        color: job.note.color,
        fontWeight: job.note.fontWeight,
        autoSize: true,
      })
      const r = createNote(
        cur,
        {
          containerId: stackId,
          x: job.pos.x,
          y: job.pos.y,
          content: job.note.content,
          kind: job.note.kind,
          role: job.note.role,
          fontSize: job.note.fontSize ?? style.fontSize,
          color: job.note.color ?? style.color,
          fontWeight: job.note.fontWeight ?? style.fontWeight,
          width: style.width,
          height: style.height,
          autoSize: false,
        } satisfies CreateNoteInput,
        { dryRun: false },
      )
      cur = r.board
      allCreated.push(...r.createdIds)
      allChanged.push(...r.changedIds)
      itemIds.push(...r.createdIds)
      continue
    }
    if (job.kind === 'link') {
      if (job.ann) {
        const annStyle = resolveNoteStyle({
          containerId: stackId,
          x: job.ann.pos.x,
          y: job.ann.pos.y,
          content: job.ann.text,
          kind: 'text',
          fontSize: 15,
          fontWeight: 500,
          color: '#3a3a3a',
          autoSize: true,
        })
        const ar = createNote(
          cur,
          {
            containerId: stackId,
            x: job.ann.pos.x,
            y: job.ann.pos.y,
            content: job.ann.text,
            kind: 'text',
            fontSize: 15,
            fontWeight: 500,
            color: '#3a3a3a',
            width: annStyle.width,
            height: annStyle.height,
            autoSize: false,
          },
          { dryRun: false },
        )
        cur = ar.board
        allCreated.push(...ar.createdIds)
        allChanged.push(...ar.changedIds)
        itemIds.push(...ar.createdIds)
      }
      const r = createLink(
        cur,
        {
          containerId: stackId,
          x: job.pos.x,
          y: job.pos.y,
          url: job.link.url,
          // Do not lock agent title — OG preview owns the card
          title: undefined,
          description: job.link.description,
          width: job.pos.width,
          height: job.pos.height,
        },
        { dryRun: false },
      )
      cur = r.board
      allCreated.push(...r.createdIds)
      allChanged.push(...r.changedIds)
      itemIds.push(...r.createdIds)
      continue
    }
    // image
    const src = job.image.dataUrl
    if (!src) {
      warnings.push(
        `image skipped (no dataUrl): ${job.image.url || job.image.fileName || 'unknown'}`,
      )
      continue
    }
    try {
      const r = createImage(
        cur,
        {
          containerId: stackId,
          x: job.pos.x,
          y: job.pos.y,
          src,
          fileName: job.image.fileName || 'image',
          width: job.pos.width,
          height: job.pos.height,
          naturalWidth: job.image.naturalWidth,
          naturalHeight: job.image.naturalHeight,
        },
        { dryRun: false },
      )
      cur = r.board
      allCreated.push(...r.createdIds)
      allChanged.push(...r.changedIds)
      itemIds.push(...r.createdIds)
    } catch (err) {
      warnings.push(
        `image failed: ${job.image.fileName || job.image.url || 'unknown'} (${err instanceof Error ? err.message : String(err)})`,
      )
    }
  }

  // Content bounds → folder chrome size (when collapsed on parent)
  let maxR = 320
  let maxB = 260
  for (const it of cur.items.filter((i) => containerOf(i) === stackId)) {
    maxR = Math.max(maxR, it.x + it.width + 48)
    maxB = Math.max(maxB, it.y + it.height + 48)
  }
  cur = {
    ...cur,
    stacks: cur.stacks.map((s) =>
      s.id === stackId
        ? {
            ...s,
            width: Math.min(480, Math.max(280, maxR * 0.35)),
            height: Math.min(380, Math.max(220, maxB * 0.3)),
          }
        : s,
    ),
  }

  // Fan preview for parent canvas (even if user later exits)
  cur = seedStackFanPreview(cur, stackId)

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

  if (isAppend) {
    warnings.push(`appended ${itemIds.length} item(s) below y≈${contentStartY}`)
  }

  return {
    board: cur,
    createdIds: allCreated,
    // Only report newly created stacks (empty on append)
    createdStackIds: allStackIds.length ? allStackIds : isAppend ? [] : [stackId],
    changedIds: allChanged,
    dryRun,
    stackId,
    itemIds,
    warnings: warnings.length ? warnings : undefined,
    enterContainerId: enterStack ? stackId : undefined,
    // Fit viewport on first open; on append keep current view unless empty shell
    fitViewport: enterStack && !isAppend,
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
