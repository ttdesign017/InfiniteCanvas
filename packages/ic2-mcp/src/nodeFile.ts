/**
 * Node.js file backend for MCP (no Tauri).
 * Preserves packedAssets so re-save does not drop media.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BoardSnapshot } from '../../../src/types/canvas'
import {
  ICANVAS_EXT,
  ICANVAS_FORMAT,
  ICANVAS_FORMAT_VERSION,
  ICANVAS_MAGIC,
  ICANVAS_MAX_TEXT_BYTES,
  assertICanvasIntegrity,
  parseICanvasFile,
  serializeICanvas,
  type ICanvasDocument,
} from '../../../src/utils/boardFile'
import { BoardOpsError } from '../../../src/board-ops/errors'

export function ensureIcanvasExt(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith(`.${ICANVAS_EXT}`) || lower.endsWith('.json')) return path
  return `${path}.${ICANVAS_EXT}`
}

export function loadSnapshotFromPath(path: string): BoardSnapshot {
  let size: number
  try {
    size = statSync(path).size
  } catch (e) {
    throw new BoardOpsError(
      'OPEN_FAILED',
      `Cannot stat board file: ${path}`,
      e instanceof Error ? e.message : String(e),
    )
  }
  if (size > ICANVAS_MAX_TEXT_BYTES) {
    throw new BoardOpsError(
      'BOARD_TOO_LARGE',
      `Project is too large to open safely (${Math.ceil(size / (1024 * 1024))} MB; limit ${Math.floor(ICANVAS_MAX_TEXT_BYTES / (1024 * 1024))} MB)`,
    )
  }

  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    throw new BoardOpsError(
      'OPEN_FAILED',
      `Cannot read board file: ${path}`,
      e instanceof Error ? e.message : String(e),
    )
  }

  try {
    return parseICanvasFile(text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/too large/i.test(msg)) {
      throw new BoardOpsError('BOARD_TOO_LARGE', msg)
    }
    if (/invalid JSON|Unable to parse/i.test(msg)) {
      throw new BoardOpsError('PARSE_FAILED', msg)
    }
    if (/not an Infinite Canvas/i.test(msg)) {
      throw new BoardOpsError('NOT_ICANVAS', msg)
    }
    throw new BoardOpsError('OPEN_FAILED', msg)
  }
}

/** Build an on-disk document, keeping packed media assets when present. */
export function snapshotToDocument(snapshot: BoardSnapshot): ICanvasDocument {
  return {
    magic: ICANVAS_MAGIC,
    format: ICANVAS_FORMAT,
    formatVersion: ICANVAS_FORMAT_VERSION,
    name: snapshot.name,
    viewport: { ...snapshot.viewport },
    homeViewport: snapshot.homeViewport
      ? { ...snapshot.homeViewport }
      : undefined,
    nextZ: snapshot.nextZ,
    items: snapshot.items,
    stacks: snapshot.stacks ?? [],
    currentContainerId: snapshot.currentContainerId,
    assets: snapshot.packedAssets ? { ...snapshot.packedAssets } : {},
  }
}

export function saveSnapshotToPath(
  snapshot: BoardSnapshot,
  path: string,
): { path: string; name: string } {
  const outPath = ensureIcanvasExt(path)
  const savedName =
    outPath.split(/[/\\]/).pop()?.replace(/\.icanvas$/i, '') ||
    snapshot.name ||
    'Untitled'
  const toWrite: BoardSnapshot = { ...snapshot, name: savedName }
  const doc = snapshotToDocument(toWrite)

  try {
    assertICanvasIntegrity(doc, {
      itemCount: toWrite.items.length,
      stackCount: toWrite.stacks?.length ?? 0,
    })
  } catch (e) {
    throw new BoardOpsError(
      'SAVE_FAILED',
      e instanceof Error ? e.message : String(e),
    )
  }

  const text = serializeICanvas(doc)
  const dir = dirname(outPath)
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const tmp = `${outPath}.${randomUUID()}.tmp`
  const bak = `${outPath}.bak`
  try {
    writeFileSync(tmp, text, 'utf8')
    if (existsSync(outPath)) {
      if (existsSync(bak)) unlinkSync(bak)
      renameSync(outPath, bak)
    }
    renameSync(tmp, outPath)
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    // best-effort restore
    try {
      if (existsSync(bak) && !existsSync(outPath)) {
        copyFileSync(bak, outPath)
      }
    } catch {
      /* ignore */
    }
    throw new BoardOpsError(
      'SAVE_FAILED',
      e instanceof Error ? e.message : String(e),
    )
  }

  return { path: outPath, name: savedName }
}
