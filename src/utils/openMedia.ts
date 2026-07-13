import { useCanvasStore } from '../store/useCanvasStore'
import { createMediaFromFile, createMediaFromPath } from './media'
import { placeItemsTight, screenToWorld } from './layout'
import type { CanvasItem } from '../types/canvas'
import * as desktop from './desktop'

async function placeMediaBatch(
  creators: Array<() => Promise<CanvasItem | null>>,
  originX: number,
  originY: number,
) {
  let z = useCanvasStore.getState().nextZ
  const raw: CanvasItem[] = []
  for (const create of creators) {
    const item = await create()
    if (item) {
      item.zIndex = z++
      raw.push(item)
    }
  }
  if (!raw.length) return
  const placed = placeItemsTight(raw, originX, originY, 4)
  useCanvasStore.getState().addItems(placed)
}

/** Open system file dialog and place media on canvas (Ctrl+O). */
export async function openMediaDialog() {
  const store = useCanvasStore.getState()
  const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2, store.viewport)
  const ox = center.x - 80
  const oy = center.y - 80

  if (desktop.isDesktop()) {
    const paths = await desktop.openMediaDialog()
    if (!paths.length) return
    await placeMediaBatch(
      paths.map((p) => () => createMediaFromPath(p, ox, oy, 0)),
      ox,
      oy,
    )
    return
  }

  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = 'image/*,video/*,.gif,.mp4,.webm,.mov,.mkv,.avi'
  input.onchange = async () => {
    const files = [...(input.files || [])]
    if (!files.length) return
    await placeMediaBatch(
      files.map((f) => () => createMediaFromFile(f, ox, oy, 0)),
      ox,
      oy,
    )
  }
  input.click()
}

/** Paste files / clipboard images onto the canvas at world center. */
export async function pasteMediaFiles(files: File[]) {
  if (!files.length) return
  const store = useCanvasStore.getState()
  const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2, store.viewport)
  const ox = center.x - 80
  const oy = center.y - 80
  await placeMediaBatch(
    files.map((f) => () => createMediaFromFile(f, ox, oy, 0)),
    ox,
    oy,
  )
}

/** Collect media files from a paste event (files + clipboard image items). */
export function collectClipboardMedia(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  const seen = new Set<string>()

  const add = (f: File | null) => {
    if (!f) return
    const isMedia =
      f.type.startsWith('image/') ||
      f.type.startsWith('video/') ||
      /\.(png|jpe?g|webp|gif|bmp|svg|avif|mp4|webm|mov|mkv|avi|m4v)$/i.test(f.name)
    if (!isMedia) return
    const key = `${f.type}|${f.size}|${f.name || 'blob'}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(f)
  }

  const items = data.items
  if (items && items.length > 0) {
    let sawFileKind = false
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'file') {
        sawFileKind = true
        add(item.getAsFile())
      }
    }
    // Only short-circuit when we actually collected media (not empty file stubs)
    if (sawFileKind && out.length > 0) return out
  }

  if (data.files?.length) {
    for (const f of Array.from(data.files)) add(f)
  }

  return out
}
