/**
 * Pre-stack free layout → nest free poses (stack-local).
 * Used by Ctrl+G nestInto: parent keeps fan on stackPreview; free x/y/rotation
 * preserve the arrangement from before the fan animation.
 */

import { STACK_FOLDER_PAD } from './layout'

export type ItemPose = {
  x: number
  y: number
  rotation: number
}

export type FreeOrigin = {
  originX: number
  originY: number
}

/** Top-left of the free layout hull (min item.x / item.y). */
export function computeFreeLayoutOrigin(
  poses: Array<{ x: number; y: number }>,
): FreeOrigin {
  if (poses.length === 0) return { originX: 0, originY: 0 }
  return {
    originX: Math.min(...poses.map((p) => p.x)),
    originY: Math.min(...poses.map((p) => p.y)),
  }
}

/**
 * Map a pre-stack free pose into stack-local free coords.
 * Origin is the pre-stack min corner; pad insets content from folder (0,0).
 */
export function freePoseFromPreStack(
  pre: ItemPose,
  origin: FreeOrigin,
  pad: number = STACK_FOLDER_PAD,
): ItemPose {
  return {
    x: pre.x - origin.originX + pad,
    y: pre.y - origin.originY + pad,
    rotation: pre.rotation,
  }
}

/**
 * Build free poses for every member that has a pre-stack entry in `startMap`.
 * Members missing from `startMap` are omitted (caller must not invent fan coords).
 */
export function buildNestFreePoses(
  memberIds: string[],
  startMap: ReadonlyMap<string, ItemPose>,
  pad: number = STACK_FOLDER_PAD,
): Map<string, ItemPose> {
  const freeStarts: ItemPose[] = []
  for (const id of memberIds) {
    const pre = startMap.get(id)
    if (pre) freeStarts.push(pre)
  }
  const origin = computeFreeLayoutOrigin(freeStarts)
  const out = new Map<string, ItemPose>()
  for (const id of memberIds) {
    const pre = startMap.get(id)
    if (!pre) continue
    out.set(id, freePoseFromPreStack(pre, origin, pad))
  }
  return out
}
