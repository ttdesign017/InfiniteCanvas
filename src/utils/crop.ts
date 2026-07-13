import type { CropRect, MediaItem, Point } from '../types/canvas'

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

export function getCrop(item: MediaItem): CropRect {
  return item.crop ?? FULL_CROP
}

/** Map a point in item local space (0..width, 0..height) to normalized crop-space coords */
export function localToCropNorm(item: MediaItem, local: Point): Point {
  return {
    x: local.x / item.width,
    y: local.y / item.height,
  }
}

/**
 * Apply a drag rectangle (in world coords) as a new crop on top of existing crop.
 * Returns updated crop (normalized to full source) and new display size.
 */
export function applyWorldCrop(
  item: MediaItem,
  worldRect: { x: number; y: number; width: number; height: number },
): { crop: CropRect; width: number; height: number; x: number; y: number } | null {
  // Intersect with item bounds
  const ix = Math.max(item.x, worldRect.x)
  const iy = Math.max(item.y, worldRect.y)
  const ix2 = Math.min(item.x + item.width, worldRect.x + worldRect.width)
  const iy2 = Math.min(item.y + item.height, worldRect.y + worldRect.height)
  const w = ix2 - ix
  const h = iy2 - iy
  if (w < 8 || h < 8) return null

  // Relative to current display
  const relX = (ix - item.x) / item.width
  const relY = (iy - item.y) / item.height
  const relW = w / item.width
  const relH = h / item.height

  const prev = getCrop(item)
  const crop: CropRect = {
    x: prev.x + relX * prev.w,
    y: prev.y + relY * prev.h,
    w: relW * prev.w,
    h: relH * prev.h,
  }

  // Clamp
  crop.x = Math.max(0, Math.min(1, crop.x))
  crop.y = Math.max(0, Math.min(1, crop.y))
  crop.w = Math.max(0.01, Math.min(1 - crop.x, crop.w))
  crop.h = Math.max(0.01, Math.min(1 - crop.y, crop.h))

  return {
    crop,
    width: w,
    height: h,
    x: ix,
    y: iy,
  }
}

/** CSS for rendering a cropped media element inside a box of item.width × item.height */
export function cropMediaStyle(item: MediaItem): Record<string, string | number> {
  const crop = getCrop(item)
  // Scale full media so the cropped region fills the box.
  // left/top % are relative to the parent viewport.
  return {
    position: 'absolute',
    width: `${(1 / crop.w) * 100}%`,
    height: `${(1 / crop.h) * 100}%`,
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    maxWidth: 'none',
    objectFit: 'fill',
  }
}
