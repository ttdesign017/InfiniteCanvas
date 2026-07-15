import type { CropRect, MediaItem } from '../types/canvas'

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

/** Rotation must be ~0 to crop (axis-aligned CSS crop only). */
export const CROP_ROTATION_EPS = 0.001

export function getCrop(item: MediaItem): CropRect {
  return item.crop ?? FULL_CROP
}

export function isAxisAlignedForCrop(item: { rotation?: number }): boolean {
  return Math.abs(item.rotation ?? 0) < CROP_ROTATION_EPS
}

export type WorldCropResult = {
  crop: CropRect
  width: number
  height: number
  x: number
  y: number
}

/**
 * Axis-aligned rectangular crop: marquee ∩ item AABB → update crop + frame.
 * Call only when rotation ≈ 0 (no pixel bake, no polygon).
 */
export function applyWorldCrop(
  item: MediaItem,
  worldRect: { x: number; y: number; width: number; height: number },
): WorldCropResult | null {
  if (worldRect.width < 4 || worldRect.height < 4) return null
  if (!isAxisAlignedForCrop(item)) return null

  const ix1 = Math.max(item.x, worldRect.x)
  const iy1 = Math.max(item.y, worldRect.y)
  const ix2 = Math.min(item.x + item.width, worldRect.x + worldRect.width)
  const iy2 = Math.min(item.y + item.height, worldRect.y + worldRect.height)
  const lw = ix2 - ix1
  const lh = iy2 - iy1
  if (lw < 8 || lh < 8) return null

  const relX = (ix1 - item.x) / Math.max(1e-6, item.width)
  const relY = (iy1 - item.y) / Math.max(1e-6, item.height)
  const relW = lw / Math.max(1e-6, item.width)
  const relH = lh / Math.max(1e-6, item.height)

  const prev = getCrop(item)
  const crop: CropRect = {
    x: prev.x + relX * prev.w,
    y: prev.y + relY * prev.h,
    w: relW * prev.w,
    h: relH * prev.h,
  }
  crop.x = Math.max(0, Math.min(1, crop.x))
  crop.y = Math.max(0, Math.min(1, crop.y))
  crop.w = Math.max(0.01, Math.min(1 - crop.x, crop.w))
  crop.h = Math.max(0.01, Math.min(1 - crop.y, crop.h))

  return {
    crop,
    width: lw,
    height: lh,
    x: ix1,
    y: iy1,
  }
}

/**
 * Expand a cropped media box back to the full source region at the current
 * display scale, keeping currently visible pixels fixed in world space under
 * CSS `transform-origin: center` + rotation. Rotation is left unchanged.
 */
export function uncropFrame(item: MediaItem): {
  x: number
  y: number
  width: number
  height: number
} | null {
  const crop = item.crop
  if (
    !crop ||
    (crop.w >= 0.999 &&
      crop.h >= 0.999 &&
      crop.x <= 0.001 &&
      crop.y <= 0.001)
  ) {
    return null
  }

  const fullW = item.width / Math.max(0.001, crop.w)
  const fullH = item.height / Math.max(0.001, crop.h)

  // Current box center (CSS transform origin) in world space
  const cx = item.x + item.width / 2
  const cy = item.y + item.height / 2

  // Crop center relative to full-image center, in unrotated local pixels
  const ox = (crop.x + crop.w / 2 - 0.5) * fullW
  const oy = (crop.y + crop.h / 2 - 0.5) * fullH

  // Keep the crop-region center fixed in world: C_new = C_old - R * (ox, oy)
  const rot = ((item.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const ncx = cx - (ox * cos - oy * sin)
  const ncy = cy - (ox * sin + oy * cos)

  return {
    x: ncx - fullW / 2,
    y: ncy - fullH / 2,
    width: fullW,
    height: fullH,
  }
}

/** CSS for rendering a cropped media element inside a box of item.width × item.height */
export function cropMediaStyle(item: MediaItem): Record<string, string | number> {
  const crop = getCrop(item)
  return {
    position: 'absolute',
    width: `${(1 / crop.w) * 100}%`,
    height: `${(1 / crop.h) * 100}%`,
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    maxWidth: 'none',
    objectFit: 'fill',
    background: 'transparent',
  }
}
