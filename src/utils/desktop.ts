/**
 * Desktop shell abstraction — Tauri 2 implementation.
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { LogicalPosition } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { ask, open as dialogOpen, save as dialogSave } from '@tauri-apps/plugin-dialog'
import { readFile, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ICANVAS_EXT } from './boardFile'

export function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

/** Convert local filesystem path to a URL the webview can load */
export function localPathToSrc(filePath: string): string {
  if (!filePath) return filePath
  if (
    filePath.startsWith('blob:') ||
    filePath.startsWith('data:') ||
    filePath.startsWith('http') ||
    filePath.startsWith('asset:')
  ) {
    return filePath
  }
  if (isDesktop()) {
    try {
      return convertFileSrc(filePath)
    } catch {
      /* fall through */
    }
  }
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('file://')) return normalized
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${normalized}`
  return `file://${normalized}`
}

export async function openMediaDialog(): Promise<string[]> {
  if (!isDesktop()) return []
  const selected = await dialogOpen({
    multiple: true,
    filters: [
      {
        name: 'Media',
        extensions: [
          'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif',
          'mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv', 'm4v',
        ],
      },
    ],
  })
  if (!selected) return []
  return Array.isArray(selected) ? selected : [selected]
}

export async function saveBoardDialog(
  defaultName = `board.${ICANVAS_EXT}`,
): Promise<string | null> {
  if (!isDesktop()) return null
  const path = await dialogSave({
    defaultPath: defaultName,
    filters: [
      { name: 'Infinite Canvas', extensions: [ICANVAS_EXT] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  return path ?? null
}

export async function loadBoardDialog(): Promise<string | null> {
  if (!isDesktop()) return null
  const selected = await dialogOpen({
    multiple: false,
    filters: [
      { name: 'Infinite Canvas', extensions: [ICANVAS_EXT, 'json'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (!selected) return null
  return Array.isArray(selected) ? selected[0] : selected
}

export async function readText(path: string): Promise<string> {
  return readTextFile(path)
}

export async function getLaunchFilePath(): Promise<string | null> {
  if (!isDesktop()) return null
  try {
    return await invoke<string | null>('get_launch_file_path')
  } catch {
    return null
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await writeTextFile(path, content)
}

/** Read file bytes (for packing media into .icanvas) */
export async function readBinaryFile(path: string): Promise<Uint8Array> {
  return readFile(path)
}

/** Native yes/no dialog */
export async function askYesNo(
  message: string,
  title = 'Infinite Canvas',
): Promise<boolean> {
  if (!isDesktop()) {
    return window.confirm(message)
  }
  return ask(message, { title, kind: 'warning' })
}

export async function openExternal(url: string): Promise<void> {
  if (isDesktop()) {
    await openUrl(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export async function windowMinimize(): Promise<void> {
  await getCurrentWindow().minimize()
}

export async function windowToggleMaximize(): Promise<boolean> {
  const win = getCurrentWindow()
  await win.toggleMaximize()
  return win.isMaximized()
}

export async function windowClose(): Promise<void> {
  await getCurrentWindow().close()
}

export async function windowQuit(): Promise<void> {
  await getCurrentWindow().close()
}

export async function windowIsMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized()
}

export async function windowStartDragging(): Promise<void> {
  await getCurrentWindow().startDragging()
}

/**
 * Right-drag window move.
 * Browser screenX/Y are CSS (logical) pixels; Tauri outerPosition is physical —
 * convert to logical so the grab point stays locked (no high-DPI drift).
 * Positions are applied via rAF so async setPosition calls never pile up.
 */
let dragOrigin: {
  mx: number
  my: number
  x: number
  y: number
  ready: boolean
} | null = null
let pendingLogical: { x: number; y: number } | null = null
let moveRaf = 0
let lastPointer: { x: number; y: number } | null = null

function flushWindowPosition() {
  moveRaf = 0
  if (!pendingLogical) return
  const { x, y } = pendingLogical
  pendingLogical = null
  void getCurrentWindow().setPosition(new LogicalPosition(x, y))
}

function queueWindowPosition(nx: number, ny: number) {
  pendingLogical = { x: nx, y: ny }
  if (!moveRaf) {
    moveRaf = requestAnimationFrame(flushWindowPosition)
  }
}

export function windowMoveStart(screenX: number, screenY: number): void {
  lastPointer = { x: screenX, y: screenY }
  // Placeholder until outerPosition resolves — move events buffer via lastPointer
  dragOrigin = { mx: screenX, my: screenY, x: 0, y: 0, ready: false }
  void (async () => {
    const win = getCurrentWindow()
    const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()])
    if (!dragOrigin) return
    // Keep the original mousedown point as origin (not lastPointer) so delta is correct
    const mx = dragOrigin.mx
    const my = dragOrigin.my
    dragOrigin = {
      mx,
      my,
      x: pos.x / scale,
      y: pos.y / scale,
      ready: true,
    }
    // Catch up if the mouse already moved while we were reading position
    if (lastPointer) {
      const nx = Math.round(dragOrigin.x + (lastPointer.x - mx))
      const ny = Math.round(dragOrigin.y + (lastPointer.y - my))
      queueWindowPosition(nx, ny)
    }
  })()
}

export function windowMoveTo(screenX: number, screenY: number): void {
  lastPointer = { x: screenX, y: screenY }
  if (!dragOrigin) return
  if (!dragOrigin.ready) return
  const nx = Math.round(dragOrigin.x + (screenX - dragOrigin.mx))
  const ny = Math.round(dragOrigin.y + (screenY - dragOrigin.my))
  queueWindowPosition(nx, ny)
}

export function windowMoveEnd(): void {
  dragOrigin = null
  lastPointer = null
  pendingLogical = null
  if (moveRaf) {
    cancelAnimationFrame(moveRaf)
    moveRaf = 0
  }
}

/** Native OS file drop (HTML5 dataTransfer.files is empty under Tauri/WebView2). */
export type NativeDropEvent =
  | { type: 'enter' | 'over'; x: number; y: number; paths: string[] }
  | { type: 'drop'; x: number; y: number; paths: string[] }
  | { type: 'leave' }

export async function onNativeFileDrop(
  handler: (event: NativeDropEvent) => void,
): Promise<UnlistenFn> {
  const win = getCurrentWindow()
  return win.onDragDropEvent(async (event) => {
    const payload = event.payload
    if (payload.type === 'leave') {
      handler({ type: 'leave' })
      return
    }
    const scale = await win.scaleFactor()
    const x = payload.position.x / scale
    const y = payload.position.y / scale
    if (payload.type === 'over') {
      handler({ type: 'over', x, y, paths: [] })
      return
    }
    handler({
      type: payload.type,
      x,
      y,
      paths: payload.paths ?? [],
    })
  })
}
