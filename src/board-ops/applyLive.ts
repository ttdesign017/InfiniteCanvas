/**
 * Apply a board-ops mutation result onto the live Zustand store.
 */

import { useCanvasStore } from '../store/useCanvasStore'
import { materializeRuntimeMediaSources } from '../utils/boardFile'
import type { BoardMutationResult } from './types'
import { getBoardMeta } from './read'

export function applyMutationToStore(
  mutation: BoardMutationResult & { stackId?: string; itemIds?: string[] },
): void {
  if (mutation.dryRun) return
  const store = useCanvasStore.getState()
  store.pushHistory()
  const items = materializeRuntimeMediaSources(mutation.board.items)
  useCanvasStore.setState({
    items,
    stacks: mutation.board.stacks,
    nextZ: mutation.board.nextZ,
    dirty: true,
    selectedIds: mutation.createdIds.length
      ? mutation.createdIds.slice(-1)
      : store.selectedIds,
    selectedStackIds: mutation.stackId
      ? [mutation.stackId]
      : store.selectedStackIds,
    editingId: null,
  })
}

export function liveBoardViewFromStore() {
  const s = useCanvasStore.getState()
  return {
    name: s.boardName,
    items: s.items,
    stacks: s.stacks,
    viewport: s.viewport,
    homeViewport: s.homeViewport,
    nextZ: s.nextZ,
    currentContainerId: s.currentContainerId,
  }
}

export function liveMetaFromStore() {
  return getBoardMeta(liveBoardViewFromStore())
}
