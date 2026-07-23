/**
 * High-level save / load for Infinite Canvas project files (UI layer).
 * Domain I/O lives in `board-ops/fileOps` — no alert there.
 */

import { useCanvasStore } from '../store/useCanvasStore'
import * as desktop from './desktop'
import { ICANVAS_EXT } from './boardFile'
import {
  ensureIcanvasExt,
  loadBoardSnapshotFromPath,
  saveBoardSnapshotToPath,
} from '../board-ops/fileOps'
import { formatBoardError } from '../board-ops/errors'
import { perfMark, perfMeasure } from './perfMarks'
import {
  askUnsavedPrompt,
  UNSAVED_PROMPT_COPY,
} from '../hooks/unsavedPrompt'
import { showAppAlert } from '../hooks/appDialog'
import { SaveQueue, type SaveQueueOptions } from './saveQueue'

/**
 * Save current board. Uses existing path when `saveAs` is false and a path is known.
 * Returns true if saved.
 */
async function performSaveCurrentBoard(
  options: SaveQueueOptions = {},
): Promise<boolean> {
  const store = useCanvasStore.getState()
  const saveAs = options?.saveAs === true

  let path = !saveAs ? store.boardFilePath : null
  if (!path) {
    const base =
      (store.boardName || 'Untitled').replace(/[<>:"/\\|?*]+/g, '_') +
      `.${ICANVAS_EXT}`
    path = await desktop.saveBoardDialog(base)
    if (!path) return false
    path = ensureIcanvasExt(path)
  }

  try {
    // Keep the exact state references present at snapshot time. Zustand updates
    // replace these objects, so a reference change means the live board moved
    // on while media was being packed or the file was being written.
    store.setSaving(true)
    perfMark('save-start')
    const saveStart = useCanvasStore.getState()
    const snapshot = store.exportBoard()
    const { path: outPath, name: savedName } = await saveBoardSnapshotToPath(
      snapshot,
      path,
    )
    perfMark('save-end')
    perfMeasure('save-total', 'save-start', 'save-end')
    store.setBoardFilePath(outPath)
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
    // flashSaveNotice clears isSaving and shows "Saved"
    store.flashSaveNotice('Saved')
    return true
  } catch (err) {
    console.error('Save board failed', err)
    store.setSaving(false)
    await showAppAlert(formatBoardError(err), 'Save failed')
    return false
  }
}

const saveQueue = new SaveQueue(performSaveCurrentBoard)

/**
 * Serialize saves and coalesce shortcut bursts into at most one follow-up.
 * This protects writeTextAtomic's shared final/.bak paths from concurrent
 * rename/remove sequences.
 */
export function saveCurrentBoard(options?: SaveQueueOptions): Promise<boolean> {
  return saveQueue.enqueue(options)
}

/** Wait until both the active save and any coalesced follow-up have finished. */
export function waitForPendingBoardSaves(): Promise<void> {
  return saveQueue.waitForIdle()
}

/** Open .icanvas (or legacy .json) from disk. Returns true if opened. */
export async function openBoardFromPath(path: string): Promise<boolean> {
  // A completed save must never write boardFilePath/dirty back onto a board
  // imported while that save was still packing or renaming files.
  await waitForPendingBoardSaves()
  const store = useCanvasStore.getState()
  try {
    perfMark('open-start')
    // File ops return a pure snapshot (asset refs + packedAssets).
    // importBoard → loadBoardIntoRuntimeFields hydrates blobs after revoke.
    const snapshot = await loadBoardSnapshotFromPath(path)
    // importBoard → hydrate blobs after revoke (see boardDocument)
    store.importBoard(snapshot)
    perfMark('open-end')
    perfMeasure('open-total', 'open-start', 'open-end')
    store.setBoardFilePath(path)
    store.clearDirty()
    return true
  } catch (err) {
    console.error('Open board failed', err)
    await showAppAlert(formatBoardError(err), 'Open failed')
    return false
  }
}

export async function openBoardFromDisk(): Promise<boolean> {
  // Re-evaluate dirty only after an already-running save has settled.
  await waitForPendingBoardSaves()
  const store = useCanvasStore.getState()
  if (store.dirty) {
    // Same in-app Save / Discard / Cancel chrome as exit prompt
    const choice = await askUnsavedPrompt(UNSAVED_PROMPT_COPY.open)
    if (choice === 'cancel') return false
    if (choice === 'save') {
      const ok = await saveCurrentBoard()
      if (!ok) return false
    }
    // 'discard' → continue to file picker without saving
  }

  const path = await desktop.loadBoardDialog()
  if (!path) return false

  return openBoardFromPath(path)
}

/**
 * Prompt before discarding work.
 * Returns: 'save' | 'discard' | 'cancel'
 * Uses the same in-app dialog as exit / open-file.
 */
export async function promptUnsavedChanges(): Promise<'save' | 'discard' | 'cancel'> {
  return askUnsavedPrompt(UNSAVED_PROMPT_COPY.close)
}
