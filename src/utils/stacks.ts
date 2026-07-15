/**
 * Nested stack model (single source of truth)
 * ------------------------------------------
 * - `StackRecord` is the folder on a parent canvas (position/size/name/z).
 * - Every item has `containerId` = which canvas it lives on (`root` or a stack id).
 * - `item.x/y/rotation` is always the pose **on its own container canvas**
 *   (free layout while inside the stack).
 * - `item.stackPreview` is the fan pose on the **parent** canvas only.
 *   Parent renders previews from this; dragging a stack moves the folder + all previews.
 *
 * Rules:
 * - Nested members must NOT keep `stacked:true` / `stackGroupId` after nesting
 *   (those flags mean "visual stack group on the *same* canvas" and would wrap
 *   the whole inner canvas in another folder).
 * - `stacked`/`stackGroupId` are only for transient same-canvas fan animation
 *   (mid Ctrl+G) or unmigrated legacy boards.
 */

import type {
  CanvasItem,
  StackFreeFanRel,
  StackRecord,
  Viewport,
} from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import {
  computeQuickStackBodies,
  STACK_FOLDER_PAD,
  stackGroupBounds,
} from './layout'
import { uid } from './id'

export function containerOf(item: Pick<CanvasItem, 'containerId'>): string {
  return item.containerId || ROOT_CONTAINER_ID
}

/** Clear same-canvas stack chrome flags (safe for nested-container members). */
export function asFreeOnContainer(
  item: CanvasItem,
  containerId: string,
  pose?: { x: number; y: number; rotation?: number },
  preview?: { x: number; y: number; rotation: number } | null,
): CanvasItem {
  const {
    stacked: _s,
    stackGroupId: _g,
    stackName: _n,
    stackPreview: _p,
    ...rest
  } = item
  const next: CanvasItem = {
    ...(rest as CanvasItem),
    ...(pose
      ? {
          x: pose.x,
          y: pose.y,
          rotation: pose.rotation ?? 0,
        }
      : {}),
  }
  if (containerId === ROOT_CONTAINER_ID) {
    delete (next as { containerId?: string }).containerId
  } else {
    next.containerId = containerId
  }
  if (preview) {
    next.stackPreview = { ...preview }
  }
  return next
}

export function itemsInContainer(
  items: CanvasItem[],
  containerId: string,
): CanvasItem[] {
  return items.filter((i) => containerOf(i) === containerId)
}

export function stacksInContainer(
  stacks: StackRecord[],
  containerId: string,
): StackRecord[] {
  return stacks.filter((s) => s.parentId === containerId)
}

/** Breadcrumb from root → current (excluding root node itself for path building) */
export function stackPath(
  stacks: StackRecord[],
  currentId: string,
): StackRecord[] {
  if (currentId === ROOT_CONTAINER_ID) return []
  const byId = new Map(stacks.map((s) => [s.id, s]))
  const path: StackRecord[] = []
  let id: string | undefined = currentId
  const guard = new Set<string>()
  while (id && id !== ROOT_CONTAINER_ID && !guard.has(id)) {
    guard.add(id)
    const node = byId.get(id)
    if (!node) break
    path.unshift(node)
    id = node.parentId
  }
  return path
}

export function stackDisplayName(
  stack: StackRecord,
  fallback = 'Untitled',
): string {
  const n = (stack.name || '').trim()
  return n || fallback
}

/** Auto-generated legacy names are treated as unnamed in visual stack chrome. */
export function stackLabelName(name: string | undefined): string {
  const trimmed = (name || '').trim()
  return /^untitled(?:_\d+)?$/i.test(trimmed) ? '' : trimmed
}

/**
 * Unique default stack name: first `Untitled`, then `Untitled_1`, `Untitled_2`, …
 * Case-insensitive against existing names.
 */
export function nextUniqueStackName(stacks: StackRecord[]): string {
  const taken = new Set(
    stacks.map((s) => (s.name || '').trim().toLowerCase()).filter(Boolean),
  )
  if (!taken.has('untitled')) return 'Untitled'
  let n = 1
  while (taken.has(`untitled_${n}`)) n += 1
  return `Untitled_${n}`
}

/** All stack ids nested under `stackId` (including itself) */
export function collectDescendantStackIds(
  stacks: StackRecord[],
  stackId: string,
): Set<string> {
  const out = new Set<string>([stackId])
  let grew = true
  while (grew) {
    grew = false
    for (const s of stacks) {
      if (out.has(s.parentId) && !out.has(s.id)) {
        out.add(s.id)
        grew = true
      }
    }
  }
  return out
}

/** Items in this stack or any nested child stack */
export function collectItemsInStackTree(
  items: CanvasItem[],
  stacks: StackRecord[],
  stackId: string,
): CanvasItem[] {
  const ids = collectDescendantStackIds(stacks, stackId)
  return items.filter((i) => ids.has(containerOf(i)))
}

/** Leaf item count under a stack (nested stacks themselves are not counted) */
export function countLeafItemsInStack(
  items: CanvasItem[],
  stacks: StackRecord[],
  stackId: string,
): number {
  return collectItemsInStackTree(items, stacks, stackId).length
}

/**
 * World offset of an item's container origin relative to `rootStackId`'s local space.
 * Item free x/y are local to their own container; this maps them into rootStack local.
 */
export function localOffsetInStack(
  stacks: StackRecord[],
  rootStackId: string,
  containerId: string,
): { x: number; y: number } {
  if (containerId === rootStackId) return { x: 0, y: 0 }
  const byId = new Map(stacks.map((s) => [s.id, s]))
  let x = 0
  let y = 0
  let id: string | undefined = containerId
  const guard = new Set<string>()
  while (id && id !== rootStackId && !guard.has(id)) {
    guard.add(id)
    const node = byId.get(id)
    if (!node) break
    x += node.x
    y += node.y
    id = node.parentId
  }
  return { x, y }
}

/** Item pose in `rootStackId` local coordinates (for fan / collapsed preview) */
export function itemPoseInStackLocal(
  item: CanvasItem,
  stacks: StackRecord[],
  rootStackId: string,
): { x: number; y: number; rotation: number } {
  const off = localOffsetInStack(stacks, rootStackId, containerOf(item))
  return {
    x: off.x + item.x,
    y: off.y + item.y,
    rotation: item.rotation ?? 0,
  }
}

/**
 * Direct free items of a stack (not items buried in nested child stacks).
 */
export function directItemsInStack(
  items: CanvasItem[],
  stackId: string,
): CanvasItem[] {
  return items.filter((i) => containerOf(i) === stackId)
}

export type NestedFanCard = {
  id: string
  x: number
  y: number
  rotation: number
  width: number
  height: number
  zIndex: number
}

/**
 * Build freeFanRel offsets for every leaf under `stack` (incl. A⊃B⊃C).
 * Offsets are relative to stack free origin: parent-abs card = stack.x + dx.
 * For deeper leaves, dx/dy are this stack's local coords (B-local for C under B).
 */
function buildDeepFreeFanRel(
  stack: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
  preferPreview: boolean,
): StackFreeFanRel[] {
  const rel: StackFreeFanRel[] = []
  const seen = new Set<string>()
  const push = (r: StackFreeFanRel) => {
    if (seen.has(r.id)) return
    seen.add(r.id)
    rel.push(r)
  }

  const direct = directItemsInStack(items, stack.id)
  if (
    preferPreview &&
    direct.length > 0 &&
    direct.every((m) => m.stackPreview)
  ) {
    for (const m of direct) {
      push({
        id: m.id,
        dx: m.stackPreview!.x - stack.x,
        dy: m.stackPreview!.y - stack.y,
        rotation: m.stackPreview!.rotation ?? 0,
      })
    }
  } else if (direct.length > 0) {
    const computed = compactNestedFanAt(
      { x: stack.x, y: stack.y },
      direct,
    )
    for (const c of computed.cards) {
      push({
        id: c.id,
        dx: c.x - stack.x,
        dy: c.y - stack.y,
        rotation: c.rotation,
      })
    }
  }

  // Nested: map each leaf into this stack's local space
  for (const child of stacksInContainer(stacks, stack.id)) {
    if (child.freeFanRel && child.freeFanRel.length > 0) {
      // Child freeFanRel is relative to child origin (child-local)
      for (const r of child.freeFanRel) {
        push({
          id: r.id,
          dx: child.x + r.dx,
          dy: child.y + r.dy,
          rotation: r.rotation,
        })
      }
      continue
    }
    const tree = collectItemsInStackTree(items, stacks, child.id)
    for (const m of tree) {
      if (!m.stackPreview) continue
      const cid = containerOf(m)
      if (cid === child.id) {
        // Direct free of child: preview is this stack's local (e.g. B-local for C's parent=B)
        push({
          id: m.id,
          dx: m.stackPreview.x,
          dy: m.stackPreview.y,
          rotation: m.stackPreview.rotation ?? 0,
        })
      } else {
        // Deeper: preview is parent(cid)-local → offset into this stack's local
        const byId = new Map(stacks.map((s) => [s.id, s]))
        const node = byId.get(cid)
        if (!node) continue
        const off = localOffsetInStack(stacks, stack.id, node.parentId)
        push({
          id: m.id,
          dx: off.x + m.stackPreview.x,
          dy: off.y + m.stackPreview.y,
          rotation: m.stackPreview.rotation ?? 0,
        })
      }
    }
  }

  return rel
}

/**
 * Resolve free fan for a nested stack on its parent without recomputing when
 * a cache exists. Includes **all leaves** under the stack (A⊃B⊃C).
 *
 * `preferPreview`: use live free stackPreview (exit of parent while still inside).
 */
export function resolveNestedFreeFan(
  stack: StackRecord,
  items: CanvasItem[],
  options?: { preferPreview?: boolean; stacks?: StackRecord[] },
): {
  cards: NestedFanCard[]
  rel: StackFreeFanRel[]
  bounds: { x: number; y: number; width: number; height: number }
  needsPersist: boolean
} {
  const stacks = options?.stacks ?? []
  const treeLeaves = (
    stacks.length > 0
      ? collectItemsInStackTree(items, stacks, stack.id)
      : directItemsInStack(items, stack.id)
  ).sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))

  const bounds = {
    x: stack.x,
    y: stack.y,
    width: stack.width,
    height: stack.height,
  }

  const cache = stack.freeFanRel
  if (cache && cache.length > 0 && treeLeaves.length > 0) {
    const byId = new Map(cache.map((c) => [c.id, c]))
    if (treeLeaves.every((m) => byId.has(m.id))) {
      const rel = treeLeaves.map((m) => {
        const c = byId.get(m.id)!
        return {
          id: m.id,
          dx: c.dx,
          dy: c.dy,
          rotation: c.rotation ?? 0,
        }
      })
      const cards: NestedFanCard[] = treeLeaves.map((m) => {
        const c = byId.get(m.id)!
        return {
          id: m.id,
          x: stack.x + c.dx,
          y: stack.y + c.dy,
          rotation: c.rotation ?? 0,
          width: m.width,
          height: m.height,
          zIndex: m.zIndex,
        }
      })
      return { cards, rel, bounds, needsPersist: false }
    }
  }

  const rel =
    stacks.length > 0
      ? buildDeepFreeFanRel(
          stack,
          items,
          stacks,
          options?.preferPreview === true,
        )
      : (() => {
          const direct = directItemsInStack(items, stack.id)
          if (
            options?.preferPreview &&
            direct.length > 0 &&
            direct.every((m) => m.stackPreview)
          ) {
            return direct.map((m) => ({
              id: m.id,
              dx: m.stackPreview!.x - stack.x,
              dy: m.stackPreview!.y - stack.y,
              rotation: m.stackPreview!.rotation ?? 0,
            }))
          }
          return compactNestedFanAt({ x: stack.x, y: stack.y }, direct).cards.map(
            (c) => ({
              id: c.id,
              dx: c.x - stack.x,
              dy: c.y - stack.y,
              rotation: c.rotation,
            }),
          )
        })()

  const itemById = new Map(items.map((i) => [i.id, i]))
  const cards: NestedFanCard[] = rel.map((r) => {
    const m = itemById.get(r.id)
    return {
      id: r.id,
      x: stack.x + r.dx,
      y: stack.y + r.dy,
      rotation: r.rotation,
      width: m?.width ?? 100,
      height: m?.height ?? 80,
      zIndex: m?.zIndex ?? 0,
    }
  })

  return { cards, rel, bounds, needsPersist: true }
}

export function freeFanRelFromLocalFan(
  fanLocal: Array<{ id: string; x: number; y: number; rotation?: number }>,
): StackFreeFanRel[] {
  // fanLocal is in folder-local space (origin = stack top-left)
  return fanLocal.map((c) => ({
    id: c.id,
    dx: c.x,
    dy: c.y,
    rotation: c.rotation ?? 0,
  }))
}

/**
 * Compact fan for a nested stack unit, pinned so folder top-left stays at
 * `origin`. Never mix origin into minX/minY (that caused +pad drift each enter).
 *
 * Card poses and bounds share the same parent-local space (e.g. A-local for B).
 * Prefer resolveNestedFreeFan for parent enter/exit — this is first-time only.
 */
export function compactNestedFanAt(
  origin: { x: number; y: number },
  members: Array<{
    id: string
    width: number
    height: number
    zIndex: number
  }>,
): {
  cards: NestedFanCard[]
  bounds: { x: number; y: number; width: number; height: number }
} {
  if (members.length === 0) {
    return {
      cards: [],
      bounds: {
        x: origin.x,
        y: origin.y,
        width: 80,
        height: 80,
      },
    }
  }
  const sorted = [...members].sort(
    (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
  )
  const compactBodies = sorted.map((m, i) => ({
    id: m.id,
    x: origin.x + STACK_FOLDER_PAD + i * 16,
    y: origin.y + STACK_FOLDER_PAD + i * 12,
    width: m.width,
    height: m.height,
    zIndex: m.zIndex,
  }))
  const fanRaw = computeQuickStackBodies(compactBodies)
  // Pin using fan cards only — do NOT Math.min with origin (systematic drift)
  const minX = Math.min(...fanRaw.map((t) => t.x))
  const minY = Math.min(...fanRaw.map((t) => t.y))
  const dx = origin.x + STACK_FOLDER_PAD - minX
  const dy = origin.y + STACK_FOLDER_PAD - minY
  const cards: NestedFanCard[] = fanRaw.map((t) => {
    const m = sorted.find((x) => x.id === t.id)!
    return {
      id: t.id,
      x: t.x + dx,
      y: t.y + dy,
      rotation: t.rotation ?? 0,
      width: m.width,
      height: m.height,
      zIndex: m.zIndex,
    }
  })
  // Rotation-aware hull so chrome always covers tilted fan cards
  const hull = folderBoundsFromFan(cards)
  if (!hull) {
    return {
      cards,
      bounds: { x: origin.x, y: origin.y, width: 80, height: 80 },
    }
  }
  // Union free origin with hull: keep anchor stable, never clip rotated corners
  // (forcing bounds to origin.x/y + unrotated hull.width caused overflow).
  const shellX = Math.min(origin.x, hull.x)
  const shellY = Math.min(origin.y, hull.y)
  const shellR = Math.max(origin.x, hull.x + hull.width)
  const shellB = Math.max(origin.y, hull.y + hull.height)
  return {
    cards,
    bounds: {
      x: shellX,
      y: shellY,
      width: Math.max(1, shellR - shellX),
      height: Math.max(1, shellB - shellY),
    },
  }
}

/**
 * Compact fan poses for a nested stack's direct members, in the parent stack's
 * local coordinates. Folder chrome must always equal stackGroupBounds(fan).
 *
 * `stackPreview` on nested members is stored in **parent-of-nested** (e.g. A-local
 * for items in B). Free layout is only for when you enter B.
 *
 * Prefer collapsedStackFanCards for multi-level piles (A⊃B⊃C).
 */
export function nestedStackFanOnParent(
  nested: StackRecord,
  items: CanvasItem[],
  stacks?: StackRecord[],
): NestedFanCard[] {
  // Full recursive fan in parent-of-nested coords when stacks graph is available
  if (stacks) {
    return collapsedStackFanCards(nested, items, stacks).map((c) => ({
      id: c.id,
      x: c.x,
      y: c.y,
      rotation: c.rotation,
      width: c.width,
      height: c.height,
      zIndex: c.zIndex,
    }))
  }
  const members = directItemsInStack(items, nested.id).sort(
    (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
  )
  if (members.length === 0) {
    return []
  }
  // Prefer existing parent-local fan previews
  const allHavePreview = members.every((m) => m.stackPreview)
  if (allHavePreview) {
    return members.map((m) => ({
      id: m.id,
      x: m.stackPreview!.x,
      y: m.stackPreview!.y,
      rotation: m.stackPreview!.rotation ?? 0,
      width: m.width,
      height: m.height,
      zIndex: m.zIndex,
    }))
  }
  // Compact fan under nested.x/y — free layout is NOT used as world pose
  return compactNestedFanAt({ x: nested.x, y: nested.y }, members).cards
}

/** Folder bounds from fan cards (always under the pile). Rotation-aware. */
export function folderBoundsFromFan(
  fan: Array<{ x: number; y: number; width: number; height: number; rotation?: number }>,
  pad = STACK_FOLDER_PAD,
): { x: number; y: number; width: number; height: number } | null {
  if (fan.length === 0) return null
  // Same math as stackGroupBounds — tilted cards must not poke outside chrome
  return stackGroupBounds(
    fan.map((m, i) =>
      ({
        id: `fan-bounds-${i}`,
        type: 'textcard',
        x: m.x,
        y: m.y,
        width: m.width,
        height: m.height,
        rotation: m.rotation ?? 0,
        zIndex: 0,
      }) as CanvasItem,
    ),
    pad,
  )
}

/**
 * Visual cards of a collapsed stack on its parent canvas (absolute parent coords).
 *
 * A⊃B⊃C positioning:
 * - Direct free members: parent-abs stackPreview.
 * - Nested child tree: child.freeFanRel is folder-local collapsed fan (gather
 *   offsets written on exit of child — must include deep leaves). Visual unit
 *   origin is recovered from a free member's stackPreview − freeFanRel so when
 *   child.x was restored to free but previews are still gather, C stays on the
 *   pile (not free child.x + free C layout).
 *
 * Nested free members' stackPreview is stack-local (A-local for B on A; not yet
 * parent-abs of outer stack). parent-abs = stack.x + visualOrigin + freeFanRel.
 */
export function collapsedStackFanCards(
  stack: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
): Array<{
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
}> {
  const cards: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
    rotation: number
    zIndex: number
  }> = []
  const itemById = new Map(items.map((i) => [i.id, i]))

  // Direct free members: stackPreview is parent-absolute
  for (const m of directItemsInStack(items, stack.id)) {
    if (!m.stackPreview) continue
    cards.push({
      id: m.id,
      x: m.stackPreview.x,
      y: m.stackPreview.y,
      width: m.width,
      height: m.height,
      rotation: m.stackPreview.rotation ?? 0,
      zIndex: m.zIndex,
    })
  }

  for (const child of stacksInContainer(stacks, stack.id)) {
    // Collapsed-fan offsets for entire child tree (must include deep leaves)
    const treeLeaves = collectItemsInStackTree(items, stacks, child.id)
    const cacheOk =
      !!child.freeFanRel &&
      child.freeFanRel.length > 0 &&
      treeLeaves.every((m) =>
        child.freeFanRel!.some((r) => r.id === m.id),
      )
    const childRel = cacheOk
      ? child.freeFanRel!
      : buildDeepFreeFanRel(child, items, stacks, true)

    // Visual origin of child unit in stack-local space (parent canvas of child).
    // Recover from free members' stackPreview + freeFanRel so when previews
    // are gather but child.x was restored to free, C still sits on the pile.
    let originX = child.x
    let originY = child.y
    const relById = new Map(childRel.map((r) => [r.id, r]))
    for (const m of directItemsInStack(items, child.id)) {
      const r = relById.get(m.id)
      if (r && m.stackPreview) {
        originX = m.stackPreview.x - r.dx
        originY = m.stackPreview.y - r.dy
        break
      }
    }

    for (const r of childRel) {
      const m = itemById.get(r.id)
      if (!m) continue
      // parent-abs of `stack` = stack.x + (visualOrigin + rel) when origin/rel
      // are stack-local (nested free members use stack-local stackPreview).
      cards.push({
        id: r.id,
        x: stack.x + originX + r.dx,
        y: stack.y + originY + r.dy,
        width: m.width,
        height: m.height,
        rotation: r.rotation,
        zIndex: m.zIndex,
      })
    }
  }

  return cards
}

/**
 * Map an item's stackPreview into parent-of-`collapsedStack` absolute coords
 * (same space as collapsedStackFanCards). Handles A⊃B⊃C depth.
 */
export function stackPreviewInCollapsedParentAbs(
  item: CanvasItem,
  collapsedStack: StackRecord,
  stacks: StackRecord[],
): { x: number; y: number; rotation: number } | null {
  if (!item.stackPreview) return null
  const cid = containerOf(item)
  // Direct member of the collapsed stack: preview is already parent-absolute
  if (cid === collapsedStack.id) {
    return {
      x: item.stackPreview.x,
      y: item.stackPreview.y,
      rotation: item.stackPreview.rotation ?? 0,
    }
  }
  // Nested: stackPreview is parent(cid)-local. Offset parent(cid) into
  // collapsedStack-local, then add collapsedStack origin for parent-absolute.
  const byId = new Map(stacks.map((s) => [s.id, s]))
  const node = byId.get(cid)
  if (!node) return null
  const parentOfContainer = node.parentId
  const off = localOffsetInStack(
    stacks,
    collapsedStack.id,
    parentOfContainer,
  )
  return {
    x: collapsedStack.x + off.x + item.stackPreview.x,
    y: collapsedStack.y + off.y + item.stackPreview.y,
    rotation: item.stackPreview.rotation ?? 0,
  }
}

/**
 * Folder bounds for collapsed stack on parent.
 * Prefer stored stack.x/y/w/h (set on exit handoff) so chrome never “snaps”
 * to a smaller recomputed hull. Only expand if fan content overflows.
 */
export function collapsedStackFolderBounds(
  stack: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
): { x: number; y: number; width: number; height: number } {
  const stored = {
    x: stack.x,
    y: stack.y,
    width: stack.width,
    height: stack.height,
  }
  const cards = collapsedStackFanCards(stack, items, stacks)
  const hull = folderBoundsFromFan(cards)
  if (!hull) return stored
  // Expand-only union — never shrink below stored shell (fixes simple-stack pop)
  const minX = Math.min(stored.x, hull.x)
  const minY = Math.min(stored.y, hull.y)
  const maxR = Math.max(stored.x + stored.width, hull.x + hull.width)
  const maxB = Math.max(stored.y + stored.height, hull.y + hull.height)
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxR - minX),
    height: Math.max(1, maxB - minY),
  }
}

/**
 * Migrate legacy flat stacks (stacked + stackGroupId) into StackRecord + containerId.
 * Positions become local to the folder origin (pad-inclusive outer bounds).
 */
export function migrateLegacyStacks(
  items: CanvasItem[],
  existing: StackRecord[] = [],
): { items: CanvasItem[]; stacks: StackRecord[] } {
  const stacks = [...existing]
  const usedIds = new Set(stacks.map((s) => s.id))
  const groups = new Map<string, CanvasItem[]>()

  for (const it of items) {
    if (!it.stacked || !it.stackGroupId) continue
    // Already in a real nested container other than root — leave flags for cleanup only
    const list = groups.get(it.stackGroupId) || []
    list.push(it)
    groups.set(it.stackGroupId, list)
  }

  if (groups.size === 0) {
    // Still strip legacy flags if any orphan stacked without group
    return {
      items: items.map((it) => stripLegacyStackFlags(it)),
      stacks,
    }
  }

  let nextItems = [...items]

  for (const [gid, members] of groups) {
    if (usedIds.has(gid)) {
      // Already a stack record — just reparent and clear flags
      const stack = stacks.find((s) => s.id === gid)!
      nextItems = nextItems.map((it) => {
        if (!members.some((m) => m.id === it.id)) return it
        return stripLegacyStackFlags({
          ...it,
          containerId: gid,
          x: it.x - stack.x - STACK_FOLDER_PAD,
          y: it.y - stack.y - STACK_FOLDER_PAD,
        })
      })
      continue
    }

    const bounds = stackGroupBounds(members)
    if (!bounds) continue

    const name =
      members.find((m) => (m.stackName || '').trim())?.stackName?.trim() || ''
    const zIndex = Math.min(...members.map((m) => m.zIndex))
    const parentId =
      members[0] && containerOf(members[0]) !== gid
        ? containerOf(members[0])
        : ROOT_CONTAINER_ID

    const record: StackRecord = {
      id: gid,
      parentId,
      name,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      zIndex,
    }
    stacks.push(record)
    usedIds.add(gid)

    nextItems = nextItems.map((it) => {
      if (!members.some((m) => m.id === it.id)) return it
      // Keep fan pose on parent; convert x/y to inner local coords
      return asFreeOnContainer(
        it,
        gid,
        {
          x: it.x - bounds.x - STACK_FOLDER_PAD,
          y: it.y - bounds.y - STACK_FOLDER_PAD,
          rotation: 0,
        },
        {
          x: it.x,
          y: it.y,
          rotation: it.rotation ?? 0,
        },
      )
    })
  }

  return {
    items: nextItems.map((it) =>
      it.stacked || it.stackGroupId ? stripLegacyStackFlags(it) : it,
    ),
    stacks,
  }
}

function stripLegacyStackFlags(item: CanvasItem): CanvasItem {
  // Keep stackPreview (parent fan); only drop same-canvas stack chrome flags
  if (!item.stacked && !item.stackGroupId && !item.stackName) return item
  const {
    stacked: _s,
    stackGroupId: _g,
    stackName: _n,
    ...rest
  } = item
  return rest as CanvasItem
}

export function createStackRecord(
  parentId: string,
  bounds: { x: number; y: number; width: number; height: number },
  zIndex: number,
  name = '',
  id?: string,
): StackRecord {
  return {
    id: id || uid('stack'),
    parentId,
    name,
    x: bounds.x,
    y: bounds.y,
    width: Math.max(80, bounds.width),
    height: Math.max(80, bounds.height),
    zIndex,
  }
}

export function withViewport(
  stack: StackRecord,
  viewport: Viewport,
): StackRecord {
  return { ...stack, viewport: { ...viewport } }
}
