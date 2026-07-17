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
    path = ensureIcanvasExt(path)
  }

  try {
    // Keep the exact state references present at snapshot time. Zustand updates
    // replace these objects, so a reference change means the live board moved
    // on while media was being packed or the file was being written.
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
    store.flashSaveNotice('Saved')
    return true
  } catch (err) {
    console.error('Save board failed', err)
    alert(`Save failed: ${formatBoardError(err)}`)
    return false
  }
}

/** Open .icanvas (or legacy .json) from disk. Returns true if opened. */
export async function openBoardFromPath(path: string): Promise<boolean> {
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
    alert(`Open failed: ${formatBoardError(err)}`)
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
