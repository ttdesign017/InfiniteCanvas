/**
 * Full-quality still capture from a live <video> element.
 * Unlike videoPosterCache (downscaled JPEG for ghosts), this keeps native
 * resolution and encodes lossless PNG for a canvas image item.
 */

import type { CropRect, MediaItem } from '../types/canvas'
import { FULL_CROP, getCrop } from './crop'
import { trackBlobUrl } from './blobUrls'
import { uid } from './id'
import { runSnapshotSpawnAnimation, setItemSpawnVisual } from './itemSpawnAnim'
import { useCanvasStore } from '../store/useCanvasStore'
import { openDetachedVideoAtTime } from './detachedVideo'
import {
  getRememberedPlaybackTime,
  preferredSnapshotTime,
} from './videoPlaybackClock'

function waitPaintedFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const vfc = (
      video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number
      }
    ).requestVideoFrameCallback
    if (typeof vfc === 'function') {
      vfc.call(video, () => requestAnimationFrame(done))
      window.setTimeout(done, 120)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(done))
  })
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    } catch {
      resolve(null)
    }
  })
}

/**
 * Capture the current decoded frame at full videoWidth × videoHeight (or
 * cropped region at source resolution). PNG, no JPEG quality loss.
 */
export async function captureVideoFramePng(
  video: HTMLVideoElement,
  crop?: CropRect,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (vw < 2 || vh < 2) return null
  if (video.readyState < 2) return null

  await waitPaintedFrame(video)

  const c = crop ?? FULL_CROP
  const sx = Math.max(0, Math.round(c.x * vw))
  const sy = Math.max(0, Math.round(c.y * vh))
  const sw = Math.max(1, Math.min(vw - sx, Math.round(c.w * vw)))
  const sh = Math.max(1, Math.min(vh - sy, Math.round(c.h * vh)))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)
  } catch {
    return null
  }

  const blob = await canvasToPngBlob(canvas)
  if (!blob || blob.size === 0) return null
  return { blob, width: sw, height: sh }
}

export function findVideoElement(itemId: string): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(
    `video[data-playback-id="${CSS.escape(itemId)}"]`,
  ) as HTMLVideoElement | null
}

/**
 * Resolve a decodable <video> for snapshot:
 * 1) live player if mounted and ready
 * 2) otherwise a detached loader seeked to the remembered (or nudged) time
 *    so Shift+C works while idle stills are shown.
 */
export async function resolveVideoElementForSnapshot(
  videoItem: MediaItem,
): Promise<{ video: HTMLVideoElement; dispose: () => void } | null> {
  if (videoItem.type !== 'video' || !videoItem.src) return null

  let live = findVideoElement(videoItem.id)
  if (!live || live.readyState < 2 || live.videoWidth < 2) {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    live = findVideoElement(videoItem.id)
  }
  if (live && live.readyState >= 2 && live.videoWidth >= 2) {
    return { video: live, dispose: () => {} }
  }

  const remembered = getRememberedPlaybackTime(videoItem.id)
  // Prefer live currentTime if element exists but not fully ready
  const fromLive =
    live && Number.isFinite(live.currentTime) ? live.currentTime : remembered
  const target = preferredSnapshotTime(fromLive, live?.duration)

  const detached = await openDetachedVideoAtTime(videoItem.src, target)
  if (!detached) return null
  return detached
}

/**
 * Extract the current frame of a selected video into a new image item.
 * The image fades in over the video, then eases downward.
 * Works while the card shows an idle still (no live decoder mounted).
 */
export async function snapshotVideoFrameToCanvas(
  videoItem: MediaItem,
): Promise<string | null> {
  if (videoItem.type !== 'video') return null

  const store = useCanvasStore.getState()
  if (store.animating) return null

  const resolved = await resolveVideoElementForSnapshot(videoItem)
  if (!resolved) return null

  try {
    const crop = getCrop(videoItem)
    const captured = await captureVideoFramePng(resolved.video, crop)
    if (!captured) return null

    const src = trackBlobUrl(URL.createObjectURL(captured.blob))
    const z = store.nextZ
    const id = uid('image')

    // Display size matches the video's current frame on canvas (not natural px)
    const displayW = videoItem.width
    const displayH = videoItem.height
    // Rest fully below the video with a small gap (no overlap)
    const GAP = 16
    const distanceY = displayH + GAP

    // Store at final pose; spawn visual starts at dy = -distanceY (over video)
    const imageItem: MediaItem = {
      id,
      type: 'image',
      src,
      fileName: `${(videoItem.fileName || 'frame').replace(/\.[^.]+$/, '') || 'frame'}_snapshot.png`,
      naturalWidth: captured.width,
      naturalHeight: captured.height,
      x: videoItem.x,
      y: videoItem.y + distanceY,
      width: displayW,
      height: displayH,
      rotation: videoItem.rotation || 0,
      zIndex: z,
      // Crop already baked into pixels — start full
      ...(videoItem.flipX ? { flipX: true } : {}),
      ...(videoItem.flipY ? { flipY: true } : {}),
    }

    // Start full size over the video (photo shutter starts from identity)
    setItemSpawnVisual(id, { opacity: 1, dy: -distanceY, scale: 1 })

    // Keep the source video selected so Shift+C can fire repeatedly
    store.addItems([imageItem], false)

    runSnapshotSpawnAnimation(id, {
      distanceY,
      shrinkMs: 140,
      settleMs: 640,
      minScale: 0.8,
    })

    return id
  } finally {
    resolved.dispose()
  }
}

/** Snapshot every currently selected video (usually one). Returns created ids. */
export async function snapshotSelectedVideos(): Promise<string[]> {
  const store = useCanvasStore.getState()
  if (store.animating) return []
  const videos = store
    .getSelectedItems()
    .filter((i): i is MediaItem => i.type === 'video')
  const ids: string[] = []
  for (const v of videos) {
    const id = await snapshotVideoFrameToCanvas(v)
    if (id) ids.push(id)
  }
  return ids
}
