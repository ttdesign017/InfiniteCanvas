/**
 * Apply a board-ops mutation result onto the live Zustand store.
 */

import { ROOT_CONTAINER_ID } from '../types/canvas'
import { useCanvasStore } from '../store/useCanvasStore'
import { materializeRuntimeMediaSources } from '../utils/boardFile'
import { containerOf } from '../utils/stacks'
import type { BoardMutationResult } from './types'
import { getBoardMeta } from './read'
import {
  partitionCreatedIds,
  verifyBoardHas,
} from './writeResult'
import { BoardOpsError } from './errors'

function fitViewportToItems(
  items: Array<{ x: number; y: number; width: number; height: number }>,
  screenW: number,
  screenH: number,
): { x: number; y: number; zoom: number } | null {
  if (items.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const it of items) {
    minX = Math.min(minX, it.x)
    minY = Math.min(minY, it.y)
    maxX = Math.max(maxX, it.x + it.width)
    maxY = Math.max(maxY, it.y + it.height)
  }
  const pad = 80
  const bw = Math.max(120, maxX - minX + pad * 2)
  const bh = Math.max(120, maxY - minY + pad * 2)
  const zoom = Math.max(
    0.15,
    Math.min(1.25, Math.min((screenW * 0.9) / bw, (screenH * 0.9) / bh)),
  )
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return {
    zoom,
    x: screenW / 2 - cx * zoom,
    y: screenH / 2 - cy * zoom,
  }
}

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

  const enterId = mutation.enterContainerId
  const shouldEnter =
    !!enterId &&
    enterId !== ROOT_CONTAINER_ID &&
    stacks.some((s) => s.id === enterId)

  let homeViewport = store.homeViewport
  let currentContainerId = store.currentContainerId
  let viewport = store.viewport

  if (shouldEnter) {
    // Persist leaving surface viewport; stay inside stack after apply (no exit).
    if (store.currentContainerId === ROOT_CONTAINER_ID) {
      homeViewport = { ...store.viewport }
    } else {
      // keep stack viewport on previous container via stacks array already on board
    }
    currentContainerId = enterId!

    if (mutation.fitViewport !== false) {
      const members = items.filter((i) => containerOf(i) === enterId)
      const screenW =
        typeof window !== 'undefined' ? window.innerWidth || 1440 : 1440
      const screenH =
        typeof window !== 'undefined' ? window.innerHeight || 900 : 900
      const fitted = fitViewportToItems(members, screenW, screenH)
      if (fitted) viewport = fitted
    }
  }

  useCanvasStore.setState({
    items,
    stacks,
    nextZ: mutation.board.nextZ,
    dirty: true,
    agentRevision: revision,
    currentContainerId,
    homeViewport,
    viewport,
    // Prefer focusing content, not the parent folder chrome
    selectedIds: partitioned.createdIds.length
      ? partitioned.createdIds.slice(-Math.min(3, partitioned.createdIds.length))
      : store.selectedIds,
    selectedStackIds: shouldEnter
      ? []
      : partitioned.createdStackIds.length
        ? partitioned.createdStackIds.slice(-1)
        : mutation.stackId
          ? [mutation.stackId]
          : store.selectedStackIds,
    editingId: null,
    editingStackGroupId: null,
    // Clear any enter/exit anim so agent enter is immediate
    animating: shouldEnter ? false : store.animating,
    stackEnterAnim: shouldEnter ? null : store.stackEnterAnim,
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
