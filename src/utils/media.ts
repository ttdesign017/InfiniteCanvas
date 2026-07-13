import type { MediaItem } from '../types/canvas'
import { localPathToSrc } from './desktop'
import { uid } from './id'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg', 'avif', 'ico', 'heic'])
const GIF_EXT = new Set(['gif'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv', 'm4v'])

export function getExtension(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function classifyMedia(fileName: string, mime?: string): 'image' | 'gif' | 'video' | null {
  const ext = getExtension(fileName)
  if (GIF_EXT.has(ext) || mime === 'image/gif') return 'gif'
  if (VIDEO_EXT.has(ext) || mime?.startsWith('video/')) return 'video'
  if (IMAGE_EXT.has(ext) || mime?.startsWith('image/')) return 'image'
  if (mime?.startsWith('video/')) return 'video'
  return null
}

export function pathToFileUrl(filePath: string): string {
  return localPathToSrc(filePath)
}

function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 })
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

function loadVideoSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth || 640,
        height: video.videoHeight || 360,
      })
      video.src = ''
    }
    video.onerror = () => reject(new Error('Failed to load video'))
    video.src = src
  })
}

const MAX_DISPLAY = 480

function fitSize(w: number, h: number): { width: number; height: number } {
  const max = Math.max(w, h)
  if (max <= MAX_DISPLAY) return { width: w, height: h }
  const scale = MAX_DISPLAY / max
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

export async function createMediaItemFromSrc(
  src: string,
  fileName: string,
  kind: 'image' | 'gif' | 'video',
  x: number,
  y: number,
  zIndex: number,
): Promise<MediaItem> {
  const size =
    kind === 'video' ? await loadVideoSize(src).catch(() => ({ width: 640, height: 360 })) : await loadImageSize(src).catch(() => ({ width: 400, height: 300 }))

  const display = fitSize(size.width, size.height)

  return {
    id: uid(kind),
    type: kind,
    src,
    fileName,
    naturalWidth: size.width,
    naturalHeight: size.height,
    x,
    y,
    width: display.width,
    height: display.height,
    rotation: 0,
    zIndex,
  }
}

export async function createMediaFromFile(
  file: File,
  x: number,
  y: number,
  zIndex: number,
): Promise<MediaItem | null> {
  const kind = classifyMedia(file.name, file.type)
  if (!kind) return null
  const src = URL.createObjectURL(file)
  return createMediaItemFromSrc(src, file.name, kind, x, y, zIndex)
}

export async function createMediaFromPath(
  filePath: string,
  x: number,
  y: number,
  zIndex: number,
): Promise<MediaItem | null> {
  const fileName = filePath.split(/[/\\]/).pop() || 'media'
  const kind = classifyMedia(fileName)
  if (!kind) return null
  const src = pathToFileUrl(filePath)
  return createMediaItemFromSrc(src, fileName, kind, x, y, zIndex)
}
