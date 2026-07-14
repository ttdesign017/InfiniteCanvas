import type { CanvasItem, Point } from '../types/canvas'

export interface LayoutTarget {
  id: string
  x: number
  y: number
  width?: number
  height?: number
  /** Degrees; clockwise positive */
  rotation?: number
}

/** Deterministic pseudo-random in [-1, 1] from string */
function hashUnit(id: string, salt: number): number {
  let h = salt * 2654435761
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 1597334677)
  h ^= h >>> 16
  return ((h >>> 0) % 2001) / 1000 - 1
}

/** Rect body for fan layout (free item or nested stack folder) */
export type FanBody = {
  id: string
  x: number
  y: number
  width: number
  height: number
  zIndex?: number
}

/**
 * Quick stack fan for mixed bodies (items + nested stack folders).
 * Offset pile; bottom flat, others random −8°…8° around bottom-left.
 */
export function computeQuickStackBodies(
  bodies: FanBody[],
  gap = 16,
): LayoutTarget[] {
  if (bodies.length === 0) return []

  const sorted = [...bodies].sort(
    (a, b) =>
      (a.zIndex ?? 0) - (b.zIndex ?? 0) || a.id.localeCompare(b.id),
  )
  const cx =
    sorted.reduce((s, i) => s + i.x + i.width / 2, 0) / sorted.length
  const cy =
    sorted.reduce((s, i) => s + i.y + i.height / 2, 0) / sorted.length

  const maxW = Math.max(...sorted.map((i) => i.width))
  const maxH = Math.max(...sorted.map((i) => i.height))

  const baseX = cx - maxW / 2
  const baseY = cy - maxH / 2

  return sorted.map((item, index) => {
    const offset = index * gap
    const rotation =
      index === 0 ? 0 : Math.max(-8, Math.min(8, hashUnit(item.id, index) * 8))
    return {
      id: item.id,
      x: baseX + offset,
      y: baseY + offset * 0.75,
      width: item.width,
      height: item.height,
      rotation,
    }
  })
}

/** Quick stack: offset fan; bottom flat, others random −8°…8° around bottom-left */
export function computeQuickStack(items: CanvasItem[], gap = 16): LayoutTarget[] {
  return computeQuickStackBodies(
    items.map((i) => ({
      id: i.id,
      x: i.x,
      y: i.y,
      width: i.width,
      height: i.height,
      zIndex: i.zIndex,
    })),
    gap,
  )
}

/** Expand selection ids to full stack groups */
export function expandStackSelection(
  ids: string[],
  items: CanvasItem[],
): string[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const out = new Set<string>()
  for (const id of ids) {
    out.add(id)
    const item = byId.get(id)
    if (item?.stackGroupId) {
      for (const other of items) {
        if (other.stackGroupId === item.stackGroupId) out.add(other.id)
      }
    }
  }
  return [...out]
}

/**
 * Outer padding around stacked items for folder chrome.
 * Top pad must clear the name tab (~24px) so the tab sits above the cards.
 * Used only for drawing the folder — NOT for align / snap.
 */
export const STACK_FOLDER_PAD = 28

export type BoundsRect = { x: number; y: number; width: number; height: number }

/**
 * Axis-aligned bounds of stack *cards only* (rotation-aware).
 * No folder chrome / name-tab padding — use for align & snap edges.
 */
export function stackCardBounds(members: CanvasItem[]): BoundsRect | null {
  if (members.length === 0) return null
  // Inflate for rotation around bottom-left
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const m of members) {
    const rot = ((m.rotation || 0) * Math.PI) / 180
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    // Corners relative to bottom-left origin
    const blx = m.x
    const bly = m.y + m.height
    const corners = [
      { lx: 0, ly: 0 },
      { lx: m.width, ly: 0 },
      { lx: m.width, ly: -m.height },
      { lx: 0, ly: -m.height },
    ]
    for (const c of corners) {
      const wx = blx + c.lx * cos - c.ly * sin
      const wy = bly + c.lx * sin + c.ly * cos
      minX = Math.min(minX, wx)
      minY = Math.min(minY, wy)
      maxX = Math.max(maxX, wx)
      maxY = Math.max(maxY, wy)
    }
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/** Folder chrome outer bounds (cards + pad, including room for name tab) */
export function stackGroupBounds(
  members: CanvasItem[],
  pad = STACK_FOLDER_PAD,
): BoundsRect | null {
  const cards = stackCardBounds(members)
  if (!cards) return null
  return {
    x: cards.x - pad,
    y: cards.y - pad,
    width: cards.width + pad * 2,
    height: cards.height + pad * 2,
  }
}

/**
 * Must match CSS `.stack-folder-body` top offset:
 * - compact (no name): 12px
 * - has name / naming: 22px
 * This is the top of the large rounded rect — NOT the name tab.
 */
export const STACK_FOLDER_BODY_TOP_COMPACT = 12
export const STACK_FOLDER_BODY_TOP_NAMED = 22

/**
 * Snap/align bounds for a stack = the large rounded folder body only.
 * Excludes the top-left name tab so top-edge snap is the body top edge.
 */
export function stackFolderBodyBounds(members: CanvasItem[]): BoundsRect | null {
  const outer = stackGroupBounds(members)
  if (!outer) return null
  const hasName = members.some((m) => (m.stackName || '').trim().length > 0)
  const bodyTop = hasName
    ? STACK_FOLDER_BODY_TOP_NAMED
    : STACK_FOLDER_BODY_TOP_COMPACT
  return {
    x: outer.x,
    y: outer.y + bodyTop,
    width: outer.width,
    height: Math.max(1, outer.height - bodyTop),
  }
}

/** Folder body edges for a nested StackRecord (parent-canvas chrome). */
export function stackRecordBodyBounds(stack: {
  x: number
  y: number
  width: number
  height: number
  name?: string
}): BoundsRect {
  const hasName = (stack.name || '').trim().length > 0
  const bodyTop = hasName
    ? STACK_FOLDER_BODY_TOP_NAMED
    : STACK_FOLDER_BODY_TOP_COMPACT
  return {
    x: stack.x,
    y: stack.y + bodyTop,
    width: stack.width,
    height: Math.max(1, stack.height - bodyTop),
  }
}

/**
 * Snap/align bounds for a collapsed stack on its parent: prefer fan previews of
 * all leaf items (including nested stacks' content). Nested stack folders are
 * not separate bodies — only the outer chrome / content hull.
 *
 * Direct members: stackPreview is parent-canvas absolute.
 * Nested members: stackPreview is outer-stack local → add stack.x/y.
 * (Deep A⊃B⊃C display uses collapsedStackFanCards which recurses correctly.)
 */
export function stackCollapsedSnapBounds(
  stack: {
    id: string
    x: number
    y: number
    width: number
    height: number
    name?: string
  },
  leafItems: CanvasItem[],
): BoundsRect {
  const previews = leafItems
    .filter((i) => i.stackPreview)
    .map((i) => {
      const p = i.stackPreview!
      const nested = (i.containerId || 'root') !== stack.id
      return {
        ...i,
        x: nested ? stack.x + p.x : p.x,
        y: nested ? stack.y + p.y : p.y,
        rotation: p.rotation ?? 0,
      } as CanvasItem
    })
  if (previews.length > 0) {
    const cards = stackCardBounds(previews)
    if (cards) {
      const hasName = (stack.name || '').trim().length > 0
      const bodyTop = hasName
        ? STACK_FOLDER_BODY_TOP_NAMED
        : STACK_FOLDER_BODY_TOP_COMPACT
      const pad = STACK_FOLDER_PAD
      const outerX = Math.min(stack.x, cards.x - pad)
      const outerY = Math.min(stack.y, cards.y - pad)
      const outerR = Math.max(
        stack.x + stack.width,
        cards.x + cards.width + pad,
      )
      const outerB = Math.max(
        stack.y + stack.height,
        cards.y + cards.height + pad,
      )
      return {
        x: outerX,
        y: outerY + bodyTop,
        width: Math.max(1, outerR - outerX),
        height: Math.max(1, outerB - outerY - bodyTop),
      }
    }
  }
  return stackRecordBodyBounds(stack)
}

/**
 * Shelf-pack items tightly left→right, top→bottom (no cell centering gaps).
 * Order follows zIndex ascending (back first); higher z ends lower-right.
 */
export function computeTightLayout(
  items: CanvasItem[],
  options: {
    originX?: number
    originY?: number
    gap?: number
    /** Max row width; default from content area estimate */
    maxRowWidth?: number
  } = {},
): LayoutTarget[] {
  if (items.length === 0) return []

  const gap = options.gap ?? 4
  // Preserve stack/selection order via z-index
  const sorted = [...items].sort((a, b) => a.zIndex - b.zIndex)

  const originX =
    options.originX ?? Math.min(...sorted.map((i) => i.x))
  const originY =
    options.originY ?? Math.min(...sorted.map((i) => i.y))

  const totalArea = sorted.reduce((s, i) => s + i.width * i.height, 0)
  const maxItemW = Math.max(...sorted.map((i) => i.width))
  const maxRowWidth =
    options.maxRowWidth ??
    Math.max(maxItemW, Math.ceil(Math.sqrt(totalArea) * 1.2))

  let x = originX
  let y = originY
  let rowH = 0
  const targets: LayoutTarget[] = []

  for (const item of sorted) {
    if (x > originX && x + item.width > originX + maxRowWidth) {
      x = originX
      y += rowH + gap
      rowH = 0
    }
    targets.push({
      id: item.id,
      x,
      y,
      rotation: 0,
    })
    x += item.width + gap
    rowH = Math.max(rowH, item.height)
  }

  return targets
}

/** Smooth layout — alias for tight top-left packing */
export function computeSmoothLayout(
  items: CanvasItem[],
  options: {
    columns?: number
    gapX?: number
    gapY?: number
    padding?: number
    originX?: number
    originY?: number
  } = {},
): LayoutTarget[] {
  const gap = options.gapX ?? options.gapY ?? 4
  return computeTightLayout(items, {
    gap,
    originX: options.originX,
    originY: options.originY,
  })
}

/** Horizontal row layout — tight single row, left-aligned */
export function computeRowLayout(items: CanvasItem[], gap = 4): LayoutTarget[] {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => a.zIndex - b.zIndex)
  const minY = Math.min(...sorted.map((i) => i.y))
  let x = Math.min(...sorted.map((i) => i.x))
  return sorted.map((item) => {
    const target = { id: item.id, x, y: minY, rotation: 0 }
    x += item.width + gap
    return target
  })
}

/** Place newly created items in a tight top-left pack from an origin */
export function placeItemsTight(
  items: CanvasItem[],
  originX: number,
  originY: number,
  gap = 4,
): CanvasItem[] {
  const targets = computeTightLayout(items, { originX, originY, gap })
  const map = new Map(targets.map((t) => [t.id, t]))
  return items.map((item) => {
    const t = map.get(item.id)
    if (!t) return item
    return { ...item, x: t.x, y: t.y, rotation: 0 }
  })
}

export function selectionBounds(items: CanvasItem[]): {
  x: number
  y: number
  width: number
  height: number
} | null {
  if (items.length === 0) return null
  const minX = Math.min(...items.map((i) => i.x))
  const minY = Math.min(...items.map((i) => i.y))
  const maxX = Math.max(...items.map((i) => i.x + i.width))
  const maxY = Math.max(...items.map((i) => i.y + i.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Bounds of all canvas content (stacks use folder outer bounds) */
export function allContentBounds(items: CanvasItem[]): {
  x: number
  y: number
  width: number
  height: number
} | null {
  if (items.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const seenGroups = new Set<string>()

  for (const item of items) {
    if (item.stackGroupId && item.stacked) {
      if (seenGroups.has(item.stackGroupId)) continue
      seenGroups.add(item.stackGroupId)
      const members = items.filter(
        (i) => i.stackGroupId === item.stackGroupId && i.stacked,
      )
      const b = stackGroupBounds(members)
      if (!b) continue
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.width)
      maxY = Math.max(maxY, b.y + b.height)
      continue
    }
    minX = Math.min(minX, item.x)
    minY = Math.min(minY, item.y)
    maxX = Math.max(maxX, item.x + item.width)
    maxY = Math.max(maxY, item.y + item.height)
  }

  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Topmost stack folder under a world point.
 * Prefers nested StackRecord folders; falls back to legacy stacked members.
 */
export function hitStackGroupAt(
  world: Point,
  items: CanvasItem[],
  options?: {
    /** Item ids currently being dragged (excluded) */
    excludeIds?: Iterable<string>
    /** Stack group ids to ignore */
    excludeGroupIds?: Iterable<string>
    /** Nested stack folders on the current canvas */
    stacks?: Array<{
      id: string
      x: number
      y: number
      width: number
      height: number
      zIndex: number
    }>
  },
): string | null {
  const excludeIds = new Set(options?.excludeIds ?? [])
  const excludeGroups = new Set(options?.excludeGroupIds ?? [])

  if (options?.stacks?.length) {
    const ranked = [...options.stacks]
      .filter((s) => !excludeGroups.has(s.id))
      .sort((a, b) => b.zIndex - a.zIndex)
    for (const s of ranked) {
      if (
        world.x >= s.x &&
        world.y >= s.y &&
        world.x <= s.x + s.width &&
        world.y <= s.y + s.height
      ) {
        return s.id
      }
    }
  }

  const groups = new Map<string, CanvasItem[]>()
  for (const it of items) {
    if (!it.stacked || !it.stackGroupId) continue
    if (excludeIds.has(it.id)) continue
    if (excludeGroups.has(it.stackGroupId)) continue
    const list = groups.get(it.stackGroupId) || []
    list.push(it)
    groups.set(it.stackGroupId, list)
  }

  const ranked = [...groups.entries()]
    .map(([gid, members]) => ({
      gid,
      members,
      maxZ: Math.max(...members.map((m) => m.zIndex)),
      bounds: stackGroupBounds(members),
    }))
    .filter((g) => g.bounds)
    .sort((a, b) => b.maxZ - a.maxZ)

  for (const g of ranked) {
    const b = g.bounds!
    if (
      world.x >= b.x &&
      world.y >= b.y &&
      world.x <= b.x + b.width &&
      world.y <= b.y + b.height
    ) {
      return g.gid
    }
  }
  return null
}

export function screenToWorld(
  sx: number,
  sy: number,
  viewport: { x: number; y: number; zoom: number },
): Point {
  return {
    x: (sx - viewport.x) / viewport.zoom,
    y: (sy - viewport.y) / viewport.zoom,
  }
}

export function worldToScreen(
  wx: number,
  wy: number,
  viewport: { x: number; y: number; zoom: number },
): Point {
  return {
    x: wx * viewport.zoom + viewport.x,
    y: wy * viewport.zoom + viewport.y,
  }
}
