import type { CanvasItem, StackRecord } from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import {
  stackCollapsedSnapBounds,
  stackFolderBodyBounds,
  stackRecordBodyBounds,
} from './layout'
import { collectItemsInStackTree } from './stacks'
import { containerOf } from './stacks'

export interface SnapGuide {
  orientation: 'v' | 'h'
  /** World coordinate of the guide line */
  pos: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
}

export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

export interface SnapContext {
  /** Nested stack folders on the board */
  stacks?: StackRecord[]
  /** Active canvas (`root` or stack id) — only bodies on this canvas snap */
  containerId?: string
  /** Stack folder ids currently being dragged (excluded as targets) */
  excludeStackIds?: Iterable<string>
}

/** Default snap distance in world units (callers pass screen-scaled values) */
const DEFAULT_THRESHOLD = 10

/**
 * Snap targets on the current canvas:
 * - Free items on this container
 * - Nested StackRecords as a single folder body (NOT fan cards / inner coords)
 * - Legacy same-canvas stacked groups as one body
 */
export function collectSnapBodies(
  allItems: CanvasItem[],
  excludeIds: Set<string>,
  ctx: SnapContext = {},
): RectLike[] {
  const bodies: RectLike[] = []
  const containerId = ctx.containerId ?? ROOT_CONTAINER_ID
  const stacks = ctx.stacks ?? []
  const excludeStackIds = new Set(ctx.excludeStackIds ?? [])
  const seenLegacy = new Set<string>()

  // Enterable stacks on this canvas → one body (folder + all nested leaf content)
  // Nested stacks (parentId ≠ containerId) are never separate snap targets here.
  for (const st of stacks) {
    if (st.parentId !== containerId) continue
    if (excludeStackIds.has(st.id)) continue
    const leaves = collectItemsInStackTree(allItems, stacks, st.id)
    if (leaves.some((m) => excludeIds.has(m.id))) continue
    bodies.push(stackCollapsedSnapBounds(st, leaves))
  }

  for (const item of allItems) {
    if (excludeIds.has(item.id)) continue
    // Nested members of enterable stacks are NOT individual snap targets on parent
    if (containerOf(item) !== containerId) continue

    if (item.stackGroupId && item.stacked) {
      if (seenLegacy.has(item.stackGroupId)) continue
      // Skip if this id is already an enterable StackRecord on this canvas
      if (stacks.some((s) => s.id === item.stackGroupId)) continue
      seenLegacy.add(item.stackGroupId)
      const members = allItems.filter(
        (i) => i.stackGroupId === item.stackGroupId && i.stacked,
      )
      if (members.some((m) => excludeIds.has(m.id))) continue
      const b = stackFolderBodyBounds(members)
      if (b) bodies.push(b)
      continue
    }

    bodies.push({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    })
  }

  return bodies
}

/**
 * Bounds of the moving set for snap.
 * Free items + optional moving stack folders (from StackRecord).
 */
export function movingSnapBounds(
  moving: CanvasItem[],
  movingStacks: Array<{
    x: number
    y: number
    width: number
    height: number
    name?: string
  }> = [],
): RectLike | null {
  const rects: RectLike[] = []

  const groups = new Map<string, CanvasItem[]>()
  const free: CanvasItem[] = []

  for (const m of moving) {
    if (m.stacked && m.stackGroupId) {
      const list = groups.get(m.stackGroupId) || []
      list.push(m)
      groups.set(m.stackGroupId, list)
    } else {
      free.push(m)
    }
  }

  for (const members of groups.values()) {
    const b = stackFolderBodyBounds(members)
    if (b) rects.push(b)
  }
  for (const f of free) {
    rects.push({ x: f.x, y: f.y, width: f.width, height: f.height })
  }
  for (const st of movingStacks) {
    rects.push(stackRecordBodyBounds(st))
  }

  if (rects.length === 0) return null
  if (rects.length === 1) return rects[0]

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function edgesFromBodies(bodies: RectLike[]) {
  const targetsV: number[] = []
  const targetsH: number[] = []
  for (const b of bodies) {
    targetsV.push(b.x, b.x + b.width / 2, b.x + b.width)
    targetsH.push(b.y, b.y + b.height / 2, b.y + b.height)
  }
  return { targetsV, targetsH }
}

export function guidesEqual(a: SnapGuide[], b: SnapGuide[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].orientation !== b[i].orientation || a[i].pos !== b[i].pos)
      return false
  }
  return true
}

/**
 * Snap a selection as a group to other bodies' edges and centers.
 */
export function computeSnapDelta(
  moving: CanvasItem[],
  allItems: CanvasItem[],
  threshold = DEFAULT_THRESHOLD,
  ctx: SnapContext & {
    movingStacks?: Array<{
      x: number
      y: number
      width: number
      height: number
      name?: string
    }>
  } = {},
): SnapResult {
  const movingStacks = ctx.movingStacks ?? []
  if (moving.length === 0 && movingStacks.length === 0) {
    return { dx: 0, dy: 0, guides: [] }
  }

  const moveIds = new Set(moving.map((i) => i.id))
  const bounds = movingSnapBounds(moving, movingStacks)
  if (!bounds) return { dx: 0, dy: 0, guides: [] }

  const bodies = collectSnapBodies(allItems, moveIds, {
    stacks: ctx.stacks,
    containerId: ctx.containerId,
    excludeStackIds: ctx.excludeStackIds,
  })
  if (bodies.length === 0) return { dx: 0, dy: 0, guides: [] }

  const { targetsV, targetsH } = edgesFromBodies(bodies)

  const selV = [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width]
  const selH = [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height]

  let bestDx = 0
  let bestAbsX = threshold + 1
  let guideV: number | null = null

  for (const s of selV) {
    for (const t of targetsV) {
      const d = t - s
      const a = Math.abs(d)
      if (a <= threshold && a < bestAbsX) {
        bestAbsX = a
        bestDx = d
        guideV = t
      }
    }
  }

  let bestDy = 0
  let bestAbsY = threshold + 1
  let guideH: number | null = null

  for (const s of selH) {
    for (const t of targetsH) {
      const d = t - s
      const a = Math.abs(d)
      if (a <= threshold && a < bestAbsY) {
        bestAbsY = a
        bestDy = d
        guideH = t
      }
    }
  }

  const guides: SnapGuide[] = []
  if (guideV !== null && bestAbsX <= threshold)
    guides.push({ orientation: 'v', pos: guideV })
  if (guideH !== null && bestAbsY <= threshold)
    guides.push({ orientation: 'h', pos: guideH })

  return {
    dx: bestAbsX <= threshold ? bestDx : 0,
    dy: bestAbsY <= threshold ? bestDy : 0,
    guides,
  }
}

export function enforceAspectFromHandle(
  rect: RectLike,
  aspect: number,
  handle: string,
  minSize = 24,
): RectLike {
  const h = (handle || 'se').toLowerCase()
  const a = Math.max(1e-6, aspect)
  const fixL = h.includes('e')
  const fixT = h.includes('s')
  const fixR = h.includes('w')
  const fixB = h.includes('n')

  const byW = Math.max(minSize, rect.width)
  const hFromW = Math.max(minSize, byW / a)
  const byH = Math.max(minSize, rect.height)
  const wFromH = Math.max(minSize, byH * a)

  const errW = Math.abs(hFromW - rect.height) + Math.abs(byW - rect.width)
  const errH = Math.abs(wFromH - rect.width) + Math.abs(byH - rect.height)
  let width = errW <= errH ? byW : wFromH
  let height = errW <= errH ? hFromW : byH

  let x = rect.x
  let y = rect.y
  if (fixR) x = rect.x + rect.width - width
  else if (fixL) x = rect.x
  if (fixB) y = rect.y + rect.height - height
  else if (fixT) y = rect.y

  if (h === 'e' || h === 'w') {
    y = rect.y + rect.height / 2 - height / 2
    if (h === 'w') x = rect.x + rect.width - width
    else x = rect.x
  }
  if (h === 'n' || h === 's') {
    x = rect.x + rect.width / 2 - width / 2
    if (h === 'n') y = rect.y + rect.height - height
    else y = rect.y
  }

  return { x, y, width, height }
}

/**
 * Snap free edges of a resized rect to nearby bodies.
 * Root cause of "guides but no snap": aspect re-lock must run AFTER snap.
 */
export function snapResizeRect(
  rect: RectLike,
  handle: string,
  selfId: string,
  allItems: CanvasItem[],
  threshold = DEFAULT_THRESHOLD,
  aspect?: number,
  ctx: SnapContext = {},
): { rect: RectLike; guides: SnapGuide[] } {
  const exclude = new Set<string>([selfId])
  const self = allItems.find((i) => i.id === selfId)
  if (self?.stackGroupId) {
    for (const i of allItems) {
      if (i.stackGroupId === self.stackGroupId) exclude.add(i.id)
    }
  }

  const bodies = collectSnapBodies(allItems, exclude, ctx)
  if (bodies.length === 0) return { rect, guides: [] }

  const { targetsV, targetsH } = edgesFromBodies(bodies)
  const h = (handle || '').toLowerCase()
  const minSize = 24

  const freeL = h === 'w' || h === 'nw' || h === 'sw'
  const freeR = h === 'e' || h === 'ne' || h === 'se'
  const freeT = h === 'n' || h === 'nw' || h === 'ne'
  const freeB = h === 's' || h === 'sw' || h === 'se'

  type Cand = {
    axis: 'v' | 'h'
    edge: 'l' | 'r' | 't' | 'b'
    target: number
    dist: number
  }

  const nearest = (
    v: number,
    targets: number[],
  ): { target: number; dist: number } | null => {
    let bestT = 0
    let bestD = threshold + 1
    let found = false
    for (const t of targets) {
      const d = Math.abs(t - v)
      if (d <= threshold && d < bestD) {
        bestD = d
        bestT = t
        found = true
      }
    }
    return found ? { target: bestT, dist: bestD } : null
  }

  const cands: Cand[] = []
  if (freeL) {
    const n = nearest(rect.x, targetsV)
    if (n) cands.push({ axis: 'v', edge: 'l', target: n.target, dist: n.dist })
  }
  if (freeR) {
    const n = nearest(rect.x + rect.width, targetsV)
    if (n) cands.push({ axis: 'v', edge: 'r', target: n.target, dist: n.dist })
  }
  if (freeT) {
    const n = nearest(rect.y, targetsH)
    if (n) cands.push({ axis: 'h', edge: 't', target: n.target, dist: n.dist })
  }
  if (freeB) {
    const n = nearest(rect.y + rect.height, targetsH)
    if (n) cands.push({ axis: 'h', edge: 'b', target: n.target, dist: n.dist })
  }

  if (cands.length === 0) return { rect, guides: [] }

  cands.sort((a, b) => a.dist - b.dist)
  const best = cands[0]

  let { x, y, width, height } = rect
  const guides: SnapGuide[] = []

  const applyEdge = (edge: Cand['edge'], target: number) => {
    if (edge === 'l') {
      const newW = x + width - target
      if (newW >= minSize) {
        width = newW
        x = target
        guides.push({ orientation: 'v', pos: target })
        return true
      }
    } else if (edge === 'r') {
      const newW = target - x
      if (newW >= minSize) {
        width = newW
        guides.push({ orientation: 'v', pos: target })
        return true
      }
    } else if (edge === 't') {
      const newH = y + height - target
      if (newH >= minSize) {
        height = newH
        y = target
        guides.push({ orientation: 'h', pos: target })
        return true
      }
    } else if (edge === 'b') {
      const newH = target - y
      if (newH >= minSize) {
        height = newH
        guides.push({ orientation: 'h', pos: target })
        return true
      }
    }
    return false
  }

  if (!applyEdge(best.edge, best.target)) {
    return { rect, guides: [] }
  }

  if (aspect != null && aspect > 0) {
    const a = Math.max(1e-6, aspect)
    const corner = h.length === 2

    if (best.axis === 'v') {
      height = Math.max(minSize, width / a)
      if (corner) {
        if (h.includes('n')) y = rect.y + rect.height - height
      } else if (h === 'e' || h === 'w') {
        y = rect.y + rect.height / 2 - height / 2
      }
    } else {
      width = Math.max(minSize, height * a)
      if (corner) {
        if (h.includes('w')) x = rect.x + rect.width - width
      } else if (h === 'n' || h === 's') {
        x = rect.x + rect.width / 2 - width / 2
      }
    }
  } else {
    const second = cands.find((c) => c.axis !== best.axis)
    if (second) applyEdge(second.edge, second.target)
  }

  return { rect: { x, y, width, height }, guides }
}
