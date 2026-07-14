import type { CanvasItem, EmbedItem, StackRecord } from '../types/canvas'
import {
  collectDescendantStackIds,
  containerOf,
} from './stacks'

export type EmbedWorldPose = {
  x: number
  y: number
  rotation: number
  /** On current canvas (free or mid-anim) or as parent fan preview */
  visible: boolean
  /** Fan preview on parent — treat as stack unit for hit-testing */
  asPreview: boolean
  stackGroupId?: string
}

/**
 * Where an embed should appear for the active container.
 * Embeds stay mounted always; this only drives pose + visibility (no remount).
 */
export function resolveEmbedWorldPose(
  item: EmbedItem,
  currentContainerId: string,
  stacks: StackRecord[],
): EmbedWorldPose {
  const cid = containerOf(item)

  // Free (or mid enter/exit anim) on the canvas we're looking at
  if (cid === currentContainerId) {
    return {
      x: item.x,
      y: item.y,
      rotation: item.rotation ?? 0,
      visible: true,
      asPreview: false,
      stackGroupId: item.stackGroupId,
    }
  }

  // Fan preview on an ancestor stack that lives on the current canvas
  // Direct members of st: stackPreview is parent-canvas absolute.
  // Nested (e.g. in B under A): stackPreview is A-local → offset by A.x/y.
  if (item.stackPreview) {
    for (const st of stacks) {
      if (st.parentId !== currentContainerId) continue
      const tree = collectDescendantStackIds(stacks, st.id)
      if (!tree.has(cid)) continue
      const nested = cid !== st.id
      return {
        x: nested
          ? st.x + item.stackPreview.x
          : item.stackPreview.x,
        y: nested
          ? st.y + item.stackPreview.y
          : item.stackPreview.y,
        rotation: item.stackPreview.rotation ?? 0,
        visible: true,
        asPreview: true,
        stackGroupId: st.id,
      }
    }
  }

  // Other canvases — keep mounted & hidden (preserves iframe browsing context)
  return {
    x: item.x,
    y: item.y,
    rotation: item.rotation ?? 0,
    visible: false,
    asPreview: false,
  }
}

/** Stable display item for CanvasItemView (pose applied, no remount). */
export function embedDisplayItem(
  item: EmbedItem,
  pose: EmbedWorldPose,
): CanvasItem {
  if (pose.asPreview && pose.stackGroupId) {
    return {
      ...item,
      x: pose.x,
      y: pose.y,
      rotation: pose.rotation,
      stacked: true,
      stackGroupId: pose.stackGroupId,
    }
  }
  return {
    ...item,
    x: pose.x,
    y: pose.y,
    rotation: pose.rotation,
  }
}
