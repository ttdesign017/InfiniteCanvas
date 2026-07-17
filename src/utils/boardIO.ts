/**
 * High-level save / load for Infinite Canvas project files.
 */

import { useCanvasStore } from '../store/useCanvasStore'
import * as desktop from './desktop'
import {
  ICANVAS_EXT,
  ICANVAS_MAX_TEXT_BYTES,
  assertICanvasIntegrity,
  isICanvasDocument,
  parseICanvasFile,
} from './boardFile'
import { packBoardSnapshotToText } from './boardDocument'
import { perfMark, perfMeasure } from './perfMarks'
import type { BoardSnapshot } from '../types/canvas'

/** In-memory integrity check before disk write (no second full-file parse). */
function verifySerializedBoard(
  written: string,
  snapshot: BoardSnapshot,
): void {
  let writtenJson: unknown
  try {
    writtenJson = JSON.parse(written)
  } catch {
    throw new Error('Save verification failed: written file is not valid JSON')
  }
  if (isICanvasDocument(writtenJson)) {
    assertICanvasIntegrity(writtenJson, {
      itemCount: snapshot.items.length,
      stackCount: snapshot.stacks?.length ?? 0,
    })
    return
  }

  const verified = parseICanvasFile(written)
  if (verified.items.length !== snapshot.items.length) {
    throw new Error(
      `Save verification failed: expected ${snapshot.items.length} items, found ${verified.items.length}`,
    )
  }
  if ((verified.stacks?.length ?? 0) !== (snapshot.stacks?.length ?? 0)) {
    throw new Error('Save verification failed: stack count mismatch after write')
  }
}

function ensureExt(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith(`.${ICANVAS_EXT}`) || lower.endsWith('.json')) return path
  return `${path}.${ICANVAS_EXT}`
}

/**
 * Save current board. Uses existing path when `saveAs` is false and a path is known.
 * Returns true if saved.
 */
export async function saveCurrentBoard(options?: {
  saveAs?: boolean
}): Promise<boolean> {
  const store = useCanvasStore.getState()
  const saveAs = options?.saveAs === true

  let path = !saveAs ? store.boardFilePath : null
  if (!path) {
    const base =
      (store.boardName || 'Untitled').replace(/[<>:"/\\|?*]+/g, '_') +
      `.${ICANVAS_EXT}`
    path = await desktop.saveBoardDialog(base)
    if (!path) return false
    path = ensureExt(path)
  }

  try {
    // Keep the exact state references present at snapshot time. Zustand updates
    // replace these objects, so a reference change means the live board moved
    // on while media was being packed or the file was being written.
    perfMark('save-start')
    const saveStart = useCanvasStore.getState()
    const snapshot = store.exportBoard()
    const savedName =
      path.split(/[/\\]/).pop()?.replace(/\.icanvas$/i, '') || snapshot.name
    snapshot.name = savedName
    perfMark('save-pack-start')
    const { text } = await packBoardSnapshotToText(snapshot)
    perfMark('save-pack-end')
    perfMeasure('save-pack', 'save-pack-start', 'save-pack-end')
    // Schema check once in memory; disk layer only checks byte length.
    await desktop.writeTextAtomic(path, text, (content) =>
      verifySerializedBoard(content, snapshot),
    )
    perfMark('save-end')
    perfMeasure('save-total', 'save-start', 'save-end')
    store.setBoardFilePath(path)
    const live = useCanvasStore.getState()
    const unchangedSinceSnapshot =
      live.items === saveStart.items &&
      live.stacks === saveStart.stacks &&
      live.viewport === saveStart.viewport &&
      live.homeViewport === saveStart.homeViewport &&
      live.nextZ === saveStart.nextZ &&
      live.boardName === saveStart.boardName &&
      live.currentContainerId === saveStart.currentContainerId
    useCanvasStore.setState({
      ...(live.boardName === saveStart.boardName
        ? { boardName: savedName }
        : {}),
      ...(unchangedSinceSnapshot ? { dirty: false } : { dirty: true }),
    })
    store.flashSaveNotice('Saved')
    return true
  } catch (err) {
    console.error('Save board failed', err)
    alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/** Open .icanvas (or legacy .json) from disk. Returns true if opened. */
export async function openBoardFromPath(path: string): Promise<boolean> {
  const store = useCanvasStore.getState()
  try {
    perfMark('open-start')
    const size = await desktop.fileSize(path)
    if (size !== null && size > ICANVAS_MAX_TEXT_BYTES) {
      throw new Error(
        `Project is too large to open safely (${Math.ceil(size / (1024 * 1024))} MB; limit ${Math.floor(ICANVAS_MAX_TEXT_BYTES / (1024 * 1024))} MB)`,
      )
    }
    const text = await desktop.readText(path)
    perfMark('open-read-end')
    perfMeasure('open-read', 'open-start', 'open-read-end')
    // parse keeps icanvas-asset:// + packedAssets; import hydrates blobs after revoke
    store.importBoard(parseICanvasFile(text))
    perfMark('open-end')
    perfMeasure('open-total', 'open-start', 'open-end')
    store.setBoardFilePath(path)
    store.clearDirty()
    return true
  } catch (err) {
    console.error('Open board failed', err)
    alert(`Open failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

export async function openBoardFromDisk(): Promise<boolean> {
  const store = useCanvasStore.getState()
  if (store.dirty) {
    const saveFirst = await desktop.askYesNo(
      'This canvas has unsaved changes. Save it before opening another file?\n\nChoosing No will discard the changes and open the selected file.',
    )
    if (saveFirst) {
      const ok = await saveCurrentBoard()
      if (!ok) return false
    }
  }

  const path = await desktop.loadBoardDialog()
  if (!path) return false

  return openBoardFromPath(path)
}

/**
 * Prompt before discarding work.
 * Returns: 'save' | 'discard' | 'cancel'
 */
export async function promptUnsavedChanges(): Promise<'save' | 'discard' | 'cancel'> {
  const store = useCanvasStore.getState()
  if (!store.dirty) return 'discard'

  // Two-step native ask: Save? then if no, Discard?
  if (desktop.isDesktop()) {
    const wantSave = await desktop.askYesNo(
      'This canvas has unsaved changes.\n\nSave it as an Infinite Canvas project (.icanvas)?\n\nYes = save and exit\nNo = continue to the discard/cancel step',
      'Save Canvas',
    )
    if (wantSave) return 'save'

    const discard = await desktop.askYesNo(
      'Continue without saving? Unsaved changes will be lost.\n\nYes = discard changes\nNo = cancel and return to editing',
      'Discard Changes',
    )
    return discard ? 'discard' : 'cancel'
  }

  // Browser fallback
  if (window.confirm('This canvas has unsaved changes. Save it?')) return 'save'
  if (window.confirm('Discard the unsaved changes?')) return 'discard'
  return 'cancel'
}
