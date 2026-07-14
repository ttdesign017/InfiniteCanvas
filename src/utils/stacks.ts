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

import type { CanvasItem, StackRecord, Viewport } from '../types/canvas'
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

/**
 * Compact fan poses for a nested stack's direct members, in the parent stack's
 * local coordinates. Folder chrome must always equal stackGroupBounds(fan).
 *
 * `stackPreview` on nested members is stored in **parent-of-nested** (e.g. A-local
 * for items in B). Free layout is only for when you enter B.
 */
export function nestedStackFanOnParent(
  nested: StackRecord,
  items: CanvasItem[],
): Array<{
  id: string
  x: number
  y: number
  rotation: number
  width: number
  height: number
  zIndex: number
}> {
  const members = directItemsInStack(items, nested.id).sort(
    (a, b) => a.zIndex - b.zIndex,
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
  // Compact fan at nested.x/y — free layout is NOT used as world pose (avoids
  // huge free-layout offsets blowing the pile across the parent canvas).
  const bodies = members.map((m, i) => ({
    id: m.id,
    x: nested.x + i * 16,
    y: nested.y + i * 12,
    width: m.width,
    height: m.height,
    zIndex: m.zIndex,
  }))
  const fan = computeQuickStackBodies(bodies)
  const minX = Math.min(...fan.map((t) => t.x))
  const minY = Math.min(...fan.map((t) => t.y))
  const dx = nested.x + STACK_FOLDER_PAD - minX
  const dy = nested.y + STACK_FOLDER_PAD - minY
  return fan.map((t) => {
    const m = members.find((x) => x.id === t.id)!
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
}

/** Folder bounds from fan cards (always under the pile). */
export function folderBoundsFromFan(
  fan: Array<{ x: number; y: number; width: number; height: number; rotation?: number }>,
  pad = STACK_FOLDER_PAD,
): { x: number; y: number; width: number; height: number } | null {
  if (fan.length === 0) return null
  // Axis-aligned pad around unrotated boxes (good enough for compact fan)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const m of fan) {
    minX = Math.min(minX, m.x)
    minY = Math.min(minY, m.y)
    maxX = Math.max(maxX, m.x + m.width)
    maxY = Math.max(maxY, m.y + m.height)
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  }
}

/**
 * Visual cards of a collapsed stack on its parent canvas (absolute parent coords).
 * - Direct free items: stackPreview is parent-absolute
 * - Nested child stacks: stackPreview is outer-stack local → offset by stack.x/y
 * Folder chrome must use this same set so bounds never “forget” nested content.
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
    const fan = nestedStackFanOnParent(child, items)
    for (const f of fan) {
      cards.push({
        id: f.id,
        x: stack.x + f.x,
        y: stack.y + f.y,
        width: f.width,
        height: f.height,
        rotation: f.rotation,
        zIndex: f.zIndex,
      })
    }
  }

  return cards
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
