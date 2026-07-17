/**
 * File-oriented board I/O without UI (no dialogs, no alert).
 * UI (`boardIO`) and future MCP file tools both call these.
 */

import type { BoardSnapshot } from '../types/canvas'
import * as desktop from '../utils/desktop'
import {
  ICANVAS_EXT,
  ICANVAS_MAX_TEXT_BYTES,
  assertICanvasIntegrity,
  isICanvasDocument,
  parseICanvasFile,
} from '../utils/boardFile'
import { packBoardSnapshotToText } from '../utils/boardDocument'
import { perfMark, perfMeasure } from '../utils/perfMarks'
import { BoardOpsError, formatBoardError } from './errors'
import {
  boardViewFromSnapshot,
  snapshotFromBoardView,
  type BoardView,
} from './types'

export function ensureIcanvasExt(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith(`.${ICANVAS_EXT}`) || lower.endsWith('.json')) return path
  return `${path}.${ICANVAS_EXT}`
}

function verifySerializedBoard(
  written: string,
  snapshot: BoardSnapshot,
): void {
  let writtenJson: unknown
  try {
    writtenJson = JSON.parse(written)
  } catch {
    throw new BoardOpsError(
      'SAVE_FAILED',
      'Save verification failed: written file is not valid JSON',
    )
  }
  if (isICanvasDocument(writtenJson)) {
    try {
      assertICanvasIntegrity(writtenJson, {
        itemCount: snapshot.items.length,
        stackCount: snapshot.stacks?.length ?? 0,
      })
    } catch (e) {
      throw new BoardOpsError(
        'SAVE_FAILED',
        formatBoardError(e),
      )
    }
    return
  }

  const verified = parseICanvasFile(written)
  if (verified.items.length !== snapshot.items.length) {
    throw new BoardOpsError(
      'SAVE_FAILED',
      `Save verification failed: expected ${snapshot.items.length} items, found ${verified.items.length}`,
    )
  }
  if ((verified.stacks?.length ?? 0) !== (snapshot.stacks?.length ?? 0)) {
    throw new BoardOpsError(
      'SAVE_FAILED',
      'Save verification failed: stack count mismatch after write',
    )
  }
}

function wrapOpenError(err: unknown): BoardOpsError {
  if (err instanceof BoardOpsError) return err
  const msg = formatBoardError(err)
  if (/too large/i.test(msg)) {
    return new BoardOpsError('BOARD_TOO_LARGE', msg)
  }
  if (/invalid JSON|Unable to parse/i.test(msg)) {
    return new BoardOpsError('PARSE_FAILED', msg)
  }
  if (/not an Infinite Canvas/i.test(msg)) {
    return new BoardOpsError('NOT_ICANVAS', msg)
  }
  return new BoardOpsError('OPEN_FAILED', msg)
}

/**
 * Load a board file into a pure BoardSnapshot (no store, no blob hydrate).
 * Runtime import should still go through `prepareBoardForRuntime` / importBoard.
 */
export async function loadBoardSnapshotFromPath(
  path: string,
): Promise<BoardSnapshot> {
  try {
    perfMark('ops-open-start')
    const size = await desktop.fileSize(path)
    if (size !== null && size > ICANVAS_MAX_TEXT_BYTES) {
      throw new BoardOpsError(
        'BOARD_TOO_LARGE',
        `Project is too large to open safely (${Math.ceil(size / (1024 * 1024))} MB; limit ${Math.floor(ICANVAS_MAX_TEXT_BYTES / (1024 * 1024))} MB)`,
      )
    }
    const text = await desktop.readText(path)
    perfMark('ops-open-read-end')
    perfMeasure('ops-open-read', 'ops-open-start', 'ops-open-read-end')
    const snap = parseICanvasFile(text)
    perfMark('ops-open-end')
    perfMeasure('ops-open-total', 'ops-open-start', 'ops-open-end')
    return snap
  } catch (err) {
    throw wrapOpenError(err)
  }
}

/** Convenience: snapshot → BoardView for pure ops. */
export async function loadBoardViewFromPath(path: string): Promise<BoardView> {
  const snap = await loadBoardSnapshotFromPath(path)
  return boardViewFromSnapshot(snap)
}

/**
 * Pack + atomic write a BoardSnapshot to disk.
 * Does not touch the live store or show UI.
 */
export async function saveBoardSnapshotToPath(
  snapshot: BoardSnapshot,
  path: string,
): Promise<{ path: string; name: string }> {
  const outPath = ensureIcanvasExt(path)
  try {
    perfMark('ops-save-start')
    const savedName =
      outPath.split(/[/\\]/).pop()?.replace(/\.icanvas$/i, '') ||
      snapshot.name
    const toWrite: BoardSnapshot = { ...snapshot, name: savedName }
    perfMark('ops-save-pack-start')
    const { text } = await packBoardSnapshotToText(toWrite)
    perfMark('ops-save-pack-end')
    perfMeasure(
      'ops-save-pack',
      'ops-save-pack-start',
      'ops-save-pack-end',
    )
    await desktop.writeTextAtomic(outPath, text, (content) =>
      verifySerializedBoard(content, toWrite),
    )
    perfMark('ops-save-end')
    perfMeasure('ops-save-total', 'ops-save-start', 'ops-save-end')
    return { path: outPath, name: savedName }
  } catch (err) {
    if (err instanceof BoardOpsError) throw err
    throw new BoardOpsError('SAVE_FAILED', formatBoardError(err))
  }
}

export async function saveBoardViewToPath(
  board: BoardView,
  path: string,
): Promise<{ path: string; name: string }> {
  return saveBoardSnapshotToPath(snapshotFromBoardView(board), path)
}
