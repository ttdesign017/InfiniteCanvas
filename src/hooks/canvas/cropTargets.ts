import type { CanvasItem, MediaItem } from '../../types/canvas'
import { isAxisAlignedForCrop } from '../../utils/crop'
import { pointInRotatedItem } from '../../utils/geometry'
import { containerOf } from '../../utils/stacks'

export const CROP_ROTATED_HINT = "Can't crop while rotated — Alt+R first"

export function isMedia(item: CanvasItem): item is MediaItem {
  return item.type === 'image' || item.type === 'gif' || item.type === 'video'
}

/**
 * Free media on the *current* canvas only.
 * Nested stack members keep free poses in their own container space —
 * treating those x/y as world would hit the wrong image and crop stacks.
 */
export function freeMediaOnCanvas(
  items: CanvasItem[],
  containerId: string,
): MediaItem[] {
  return items
    .filter(isMedia)
    .filter((m) => !m.stacked && containerOf(m) === containerId)
    .sort((a, b) => b.zIndex - a.zIndex)
}

/**
 * Crop targets: free image/gif/video on current canvas only.
 * - Multi-select free media → all selected free media (rotated ones filtered out)
 * - Single / none → media under cursor, else the single selected free media
 * Rotated media cannot crop; if every candidate is rotated, rotatedOnly=true for toast.
 */
export function resolveCropTargets(
  world: { x: number; y: number },
  items: CanvasItem[],
  selectedIds: string[],
  selectedStackIds: string[],
  containerId: string,
): { ids: string[]; rotatedOnly: boolean } {
  const free = freeMediaOnCanvas(items, containerId)
  const selectedMedia = free.filter((i) => selectedIds.includes(i.id))

  let candidates: MediaItem[] = []

  if (selectedMedia.length >= 2) {
    candidates = selectedMedia
  } else {
    let hit: MediaItem | null = null
    for (const m of selectedMedia) {
      if (pointInRotatedItem(world, m)) {
        hit = m
        break
      }
    }
    if (!hit) {
      for (const m of free) {
        if (pointInRotatedItem(world, m)) {
          hit = m
          break
        }
      }
    }
    if (hit) {
      candidates = [hit]
    } else if (selectedMedia.length === 1) {
      candidates = selectedMedia
    } else {
      return { ids: [], rotatedOnly: false }
    }
  }

  const axis = candidates.filter(isAxisAlignedForCrop)
  if (axis.length > 0) {
    return { ids: axis.map((m) => m.id), rotatedOnly: false }
  }
  if (candidates.length > 0) {
    return { ids: [], rotatedOnly: true }
  }
  void selectedStackIds
  return { ids: [], rotatedOnly: false }
}
