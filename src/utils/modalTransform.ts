/**
 * Blender-style modal G / R / S transforms (grab / rotate / scale).
 * Keyboard R/S only apply to media / free text / scribble.
 * G works for all free bodies including stacks / notes / links / embeds.
 * Note/link still use normal selection resize handles (not restricted here).
 */

import type { CanvasItem, StackRecord } from '../types/canvas'
import { computeSnapDelta, type SnapGuide } from './snap'

export type ModalTransformKind = 'grab' | 'rotate' | 'scale'

export function canRotateOrScaleItem(item: CanvasItem): boolean {
  return (
    item.type === 'image' ||
    item.type === 'gif' ||
    item.type === 'video' ||
    item.type === 'text' ||
    item.type === 'scribble'
  )
}

export function itemCenter(item: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number } {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 }
}

export function selectionPivot(
  items: CanvasItem[],
  stacks: StackRecord[],
  itemIds: string[],
  stackIds: string[],
): { x: number; y: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const hit = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  const idSet = new Set(itemIds)
  for (const it of items) {
    if (!idSet.has(it.id)) continue
    hit(it.x, it.y, it.width, it.height)
  }
  const sSet = new Set(stackIds)
  for (const st of stacks) {
    if (!sSet.has(st.id)) continue
    hit(st.x, st.y, st.width, st.height)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0 }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

export interface ModalTransformSession {
  kind: ModalTransformKind
  itemIds: string[]
  stackIds: string[]
  /** Only items that accept R/S */
  scaleRotateIds: string[]
  pivot: { x: number; y: number }
  startClient: { x: number; y: number }
  startDist: number
  startAngle: number
  itemOrigins: Record<
    string,
    { x: number; y: number; width: number; height: number; rotation: number }
  >
  stackOrigins: Record<string, { x: number; y: number }>
  /** Snapshot to restore on RMB cancel */
  cancelItems: CanvasItem[]
  cancelStacks: StackRecord[]
}

export function beginModalTransform(
  kind: ModalTransformKind,
  items: CanvasItem[],
  stacks: StackRecord[],
  selectedIds: string[],
  selectedStackIds: string[],
  clientX: number,
  clientY: number,
  viewport: { x: number; y: number; zoom: number },
): ModalTransformSession | null {
  const freeItems = items.filter(
    (i) => selectedIds.includes(i.id) && !i.stacked,
  )
  const itemIds = freeItems.map((i) => i.id)
  const stackIds = [...selectedStackIds]
  if (itemIds.length === 0 && stackIds.length === 0) return null

  if (kind !== 'grab') {
    const rotatable = freeItems.filter(canRotateOrScaleItem)
    if (rotatable.length === 0) return null
  }

  const scaleRotateIds = freeItems
    .filter(canRotateOrScaleItem)
    .map((i) => i.id)

  // Single-item R/S: pivot = that item's center (transform-origin: center)
  // Multi: selection bbox center
  let pivot: { x: number; y: number }
  if (
    (kind === 'rotate' || kind === 'scale') &&
    scaleRotateIds.length === 1 &&
    stackIds.length === 0
  ) {
    const o = freeItems.find((i) => i.id === scaleRotateIds[0])!
    pivot = itemCenter(o)
  } else {
    pivot = selectionPivot(items, stacks, itemIds, stackIds)
  }

  const wx = (clientX - viewport.x) / viewport.zoom
  const wy = (clientY - viewport.y) / viewport.zoom
  const startDist = Math.max(8, Math.hypot(wx - pivot.x, wy - pivot.y))
  const startAngle = Math.atan2(wy - pivot.y, wx - pivot.x)

  const itemOrigins: ModalTransformSession['itemOrigins'] = {}
  for (const id of itemIds) {
    const it = items.find((i) => i.id === id)
    if (!it) continue
    itemOrigins[id] = {
      x: it.x,
      y: it.y,
      width: it.width,
      height: it.height,
      rotation: it.rotation ?? 0,
    }
  }
  const stackOrigins: Record<string, { x: number; y: number }> = {}
  for (const id of stackIds) {
    const st = stacks.find((s) => s.id === id)
    if (st) stackOrigins[id] = { x: st.x, y: st.y }
  }

  return {
    kind,
    itemIds,
    stackIds,
    scaleRotateIds,
    pivot,
    startClient: { x: clientX, y: clientY },
    startDist,
    startAngle,
    itemOrigins,
    stackOrigins,
    cancelItems: items.map((i) => ({ ...i })),
    cancelStacks: stacks.map((s) => ({ ...s })),
  }
}

/** Angle step when holding Shift during R rotate (degrees). No visual guides. */
export const ROTATE_ANGLE_SNAP_DEG = 15

export function snapRotationDeg(
  deg: number,
  step: number = ROTATE_ANGLE_SNAP_DEG,
): number {
  if (step <= 0) return deg
  return Math.round(deg / step) * step
}

export function applyModalTransform(
  session: ModalTransformSession,
  clientX: number,
  clientY: number,
  viewport: { x: number; y: number; zoom: number },
  options?: {
    snapEnabled?: boolean
    /** R mode: Shift → snap each item's rotation to 15° (no guides) */
    angleSnap?: boolean
    allItems?: CanvasItem[]
    allStacks?: StackRecord[]
    containerId?: string
  },
): {
  itemPatches: Array<{ id: string; patch: Partial<CanvasItem> }>
  stackPatches: Array<{ id: string; patch: Partial<StackRecord> }>
  guides: SnapGuide[]
} {
  const zoom = Math.max(0.01, viewport.zoom)
  const wx = (clientX - viewport.x) / zoom
  const wy = (clientY - viewport.y) / zoom
  const itemPatches: Array<{ id: string; patch: Partial<CanvasItem> }> = []
  const stackPatches: Array<{ id: string; patch: Partial<StackRecord> }> = []
  let guides: SnapGuide[] = []

  if (session.kind === 'grab') {
    let dx = (clientX - session.startClient.x) / zoom
    let dy = (clientY - session.startClient.y) / zoom

    if (
      options?.snapEnabled &&
      options.allItems &&
      (session.itemIds.length > 0 || session.stackIds.length > 0)
    ) {
      const freeTargets = session.itemIds.map((id) => {
        const o = session.itemOrigins[id]
        return {
          id,
          x: (o?.x ?? 0) + dx,
          y: (o?.y ?? 0) + dy,
          width: o?.width ?? 0,
          height: o?.height ?? 0,
          type: 'text' as const,
          rotation: o?.rotation ?? 0,
          zIndex: 0,
        } as CanvasItem
      })
      const movingStacks = session.stackIds.map((id) => {
        const o = session.stackOrigins[id]
        const sk = options.allStacks?.find((s) => s.id === id)
        return {
          x: (o?.x ?? sk?.x ?? 0) + dx,
          y: (o?.y ?? sk?.y ?? 0) + dy,
          width: sk?.width ?? 100,
          height: sk?.height ?? 100,
          name: sk?.name,
        }
      })
      const threshold = 10 / zoom
      const snap = computeSnapDelta(freeTargets, options.allItems, threshold, {
        stacks: options.allStacks,
        containerId: options.containerId,
        excludeStackIds: session.stackIds,
        movingStacks,
      })
      dx += snap.dx
      dy += snap.dy
      guides = snap.guides
    }

    for (const id of session.itemIds) {
      const o = session.itemOrigins[id]
      if (!o) continue
      itemPatches.push({ id, patch: { x: o.x + dx, y: o.y + dy } })
    }
    for (const id of session.stackIds) {
      const o = session.stackOrigins[id]
      if (!o) continue
      stackPatches.push({ id, patch: { x: o.x + dx, y: o.y + dy } })
    }
    return { itemPatches, stackPatches, guides }
  }

  if (session.kind === 'rotate') {
    const angle = Math.atan2(wy - session.pivot.y, wx - session.pivot.x)
    const deltaDeg = ((angle - session.startAngle) * 180) / Math.PI
    // Orbit poses use continuous delta; only display rotation snaps on Shift
    const rad = (deltaDeg * Math.PI) / 180
    for (const id of session.scaleRotateIds) {
      const o = session.itemOrigins[id]
      if (!o) continue
      // Rotate around geometric center (matches CSS transform-origin: center)
      const cx = o.x + o.width / 2
      const cy = o.y + o.height / 2
      const dx = cx - session.pivot.x
      const dy = cy - session.pivot.y
      const ncx = session.pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad)
      const ncy = session.pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad)
      const rawRot = o.rotation + deltaDeg
      const nextRot = options?.angleSnap
        ? snapRotationDeg(rawRot)
        : rawRot
      itemPatches.push({
        id,
        patch: {
          x: ncx - o.width / 2,
          y: ncy - o.height / 2,
          rotation: nextRot,
        },
      })
    }
    // Angle snap never draws edge guides
    return { itemPatches, stackPatches, guides: [] }
  }

  // scale — from geometric center
  const dist = Math.max(8, Math.hypot(wx - session.pivot.x, wy - session.pivot.y))
  const factor = Math.min(8, Math.max(0.05, dist / session.startDist))
  for (const id of session.scaleRotateIds) {
    const o = session.itemOrigins[id]
    if (!o) continue
    const cx = o.x + o.width / 2
    const cy = o.y + o.height / 2
    const nw = Math.max(24, o.width * factor)
    const nh = Math.max(24, o.height * factor)
    const ncx = session.pivot.x + (cx - session.pivot.x) * factor
    const ncy = session.pivot.y + (cy - session.pivot.y) * factor
    const patch: Partial<CanvasItem> = {
      x: ncx - nw / 2,
      y: ncy - nh / 2,
      width: nw,
      height: nh,
    }
    const liveType = session.cancelItems.find((i) => i.id === id)
    if (liveType?.type === 'text') {
      const baseFont = (liveType as { fontSize?: number }).fontSize ?? 28
      ;(patch as { fontSize?: number }).fontSize = Math.max(
        8,
        Math.round(baseFont * factor),
      )
    }
    itemPatches.push({ id, patch })
  }
  return { itemPatches, stackPatches, guides }
}
