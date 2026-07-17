/**
 * Board document contract — single place for snapshot / pack / open hydration.
 * UI (boardIO) and future MCP tools should go through these helpers so media
 * materialization and z-reflow stay consistent.
 */

import type { BoardSnapshot, CanvasItem, StackRecord, Viewport } from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { cloneItemsDeep, cloneStacksDeep } from '../store/cloneDocument'
import { normalizeImportedItems } from '../store/actionHelpers'
import { migrateLegacyStacks } from './stacks'
import { reflowContainerSurfaceZ } from './zOrder'
import { revokeAllTrackedBlobUrls } from './blobUrls'
import {
  assertICanvasIntegrity,
  materializeRuntimeMediaSources,
  packICanvasDocument,
  parseICanvasFile,
  serializeICanvas,
  type ICanvasDocument,
} from './boardFile'

/** Live store fields needed to build a portable BoardSnapshot. */
export type BoardStateSlice = {
  items: CanvasItem[]
  stacks: StackRecord[]
  viewport: Viewport
  homeViewport: Viewport
  nextZ: number
  boardName: string
  currentContainerId: string
}

/** Deep-cloned board snapshot suitable for pack / clipboard / MCP read. */
export function snapshotBoard(state: BoardStateSlice): BoardSnapshot {
  const {
    items,
    stacks,
    viewport,
    homeViewport,
    nextZ,
    boardName,
    currentContainerId,
  } = state
  return {
    version: 1 as const,
    name: boardName,
    viewport: { ...viewport },
    homeViewport: {
      ...(currentContainerId === ROOT_CONTAINER_ID ? viewport : homeViewport),
    },
    items: cloneItemsDeep(items),
    nextZ,
    stacks: cloneStacksDeep(stacks),
    currentContainerId,
  }
}

/**
 * Prepare a parsed / external BoardSnapshot for runtime:
 * migrate stacks, materialize media blobs, reflow stack z atomicity.
 * Caller should revoke previous blob URLs before applying the result.
 */
export function prepareBoardForRuntime(board: BoardSnapshot): {
  items: CanvasItem[]
  stacks: StackRecord[]
  currentContainerId: string
  homeViewport: Viewport
  viewport: Viewport
  nextZ: number
  boardName: string
} {
  const normalized = normalizeImportedItems(board.items)
  const migrated = migrateLegacyStacks(normalized, board.stacks ?? [])
  const currentContainerId = board.currentContainerId || ROOT_CONTAINER_ID
  const homeViewport =
    currentContainerId === ROOT_CONTAINER_ID
      ? { ...board.viewport }
      : board.homeViewport
        ? { ...board.homeViewport }
        : { x: 0, y: 0, zoom: 1 }

  // packedAssets → blob: here (after caller revoked previous board blobs)
  const hydratedItems = materializeRuntimeMediaSources(
    migrated.items,
    board.packedAssets,
  )
  // Inner canvases first (relative order), then root last so each stack unit
  // is one exclusive contiguous z block on the parent surface (atomic fans).
  let nextItems = hydratedItems
  let nextStacks = migrated.stacks
  let nextZ = board.nextZ
  const containers = [
    ...migrated.stacks.map((st) => st.id),
    ROOT_CONTAINER_ID,
  ]
  for (const cid of containers) {
    const sub = reflowContainerSurfaceZ(nextItems, nextStacks, cid)
    nextItems = nextItems.map((item) =>
      sub.itemZMap.has(item.id)
        ? { ...item, zIndex: sub.itemZMap.get(item.id)! }
        : item,
    )
    nextStacks = nextStacks.map((s) =>
      sub.stackZMap.has(s.id) ? { ...s, zIndex: sub.stackZMap.get(s.id)! } : s,
    )
    nextZ = Math.max(nextZ, sub.nextZ)
  }

  return {
    items: nextItems,
    stacks: nextStacks,
    currentContainerId,
    homeViewport,
    viewport: { ...board.viewport },
    nextZ,
    boardName: board.name || 'Untitled Board',
  }
}

/** Parse file text → runtime-ready board fields (does not touch the store). */
export function openBoardDocumentFromText(text: string): ReturnType<
  typeof prepareBoardForRuntime
> {
  const board = parseICanvasFile(text)
  return prepareBoardForRuntime(board)
}

/** Pack a snapshot to serialized .icanvas text with integrity check. */
export async function packBoardSnapshotToText(
  snapshot: BoardSnapshot,
): Promise<{ text: string; doc: ICanvasDocument }> {
  const doc = await packICanvasDocument(snapshot)
  assertICanvasIntegrity(doc, {
    itemCount: snapshot.items.length,
    stackCount: snapshot.stacks?.length ?? 0,
  })
  return { text: serializeICanvas(doc), doc }
}

/**
 * Full open pipeline for store replacement: revoke old blobs, prepare, return
 * fields for set(). Used by importBoard and boardIO.
 */
export function loadBoardIntoRuntimeFields(board: BoardSnapshot): ReturnType<
  typeof prepareBoardForRuntime
> {
  revokeAllTrackedBlobUrls()
  return prepareBoardForRuntime(board)
}
