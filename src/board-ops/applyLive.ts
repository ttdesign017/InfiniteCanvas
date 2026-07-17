/**
 * Apply a board-ops mutation result onto the live Zustand store.
 */

import { useCanvasStore } from '../store/useCanvasStore'
import { materializeRuntimeMediaSources } from '../utils/boardFile'
import type { BoardMutationResult } from './types'
import { getBoardMeta } from './read'
import {
  partitionCreatedIds,
  verifyBoardHas,
} from './writeResult'
import { BoardOpsError } from './errors'

export function applyMutationToStore(
  mutation: BoardMutationResult & { stackId?: string; itemIds?: string[] },
): number {
  if (mutation.dryRun) {
    return useCanvasStore.getState().agentRevision ?? 0
  }
  const store = useCanvasStore.getState()
  store.pushHistory()
  const items = materializeRuntimeMediaSources(mutation.board.items)
  const revision = (store.agentRevision ?? 0) + 1
  const stacks = mutation.board.stacks
  // Read-after-write before committing visibility
  const partitioned = partitionCreatedIds(
    { ...mutation.board, items, stacks },
    mutation.createdIds,
    mutation.createdStackIds ??
      (mutation.stackId ? [mutation.stackId] : undefined),
  )
  const verified = verifyBoardHas(
    {
      name: store.boardName,
      items,
      stacks,
      viewport: store.viewport,
      homeViewport: store.homeViewport,
      nextZ: mutation.board.nextZ,
      currentContainerId: store.currentContainerId,
    },
    {
      itemIds: partitioned.createdIds,
      stackIds: partitioned.createdStackIds,
    },
  )
  if (
    verified.missingItems.length > 0 ||
    verified.missingStacks.length > 0
  ) {
    throw new BoardOpsError(
      'INTERNAL',
      'Live apply verification failed',
      JSON.stringify(verified),
    )
  }

  useCanvasStore.setState({
    items,
    stacks,
    nextZ: mutation.board.nextZ,
    dirty: true,
    agentRevision: revision,
    selectedIds: partitioned.createdIds.length
      ? partitioned.createdIds.slice(-1)
      : store.selectedIds,
    selectedStackIds: partitioned.createdStackIds.length
      ? partitioned.createdStackIds.slice(-1)
      : mutation.stackId
        ? [mutation.stackId]
        : store.selectedStackIds,
    editingId: null,
  })
  return revision
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
    revision: s.agentRevision ?? 0,
  }
}

export function liveMetaFromStore() {
  return getBoardMeta(liveBoardViewFromStore())
}
