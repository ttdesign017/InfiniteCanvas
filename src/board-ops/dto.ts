/**
 * Agent-safe DTOs — never embed multi-MB media payloads.
 * Runtime CanvasItem stays the source of truth for the app; DTOs are projections.
 */

import type { ItemType, Viewport } from '../types/canvas'

/** Compact pose shared by list rows and get_item. */
export type PoseDto = {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
}

/** Media presence without bytes / blob URLs. */
export type MediaRefDto = {
  hasMedia: true
  fileName?: string
  naturalWidth?: number
  naturalHeight?: number
  /** Hint only — not a loadable runtime URL for agents */
  srcKind?: 'blob' | 'data' | 'asset' | 'http' | 'path' | 'other'
}

export type ItemSummaryDto = {
  id: string
  type: ItemType
  containerId: string
  pose: PoseDto
  /** Short label for LLM lists (filename, title, truncated text) */
  label: string
  locked?: boolean
  media?: MediaRefDto
  /** Link URL when type=link */
  url?: string
}

export type ItemDetailDto = ItemSummaryDto & {
  /** Full text for notes / free text (not media bytes) */
  content?: string
  /** Style subset for text-like items */
  style?: {
    fontSize?: number
    fontFamily?: string
    fontWeight?: number
    color?: string
    backgroundColor?: string
  }
  link?: {
    url: string
    title?: string
    description?: string
  }
}

export type StackSummaryDto = {
  id: string
  parentId: string
  name: string
  pose: PoseDto
  childStackCount: number
  itemCount: number
}

export type StackTreeNodeDto = StackSummaryDto & {
  children: StackTreeNodeDto[]
}

export type BoardMetaDto = {
  name: string
  itemCount: number
  stackCount: number
  currentContainerId: string
  viewport: Viewport
  homeViewport?: Viewport
  nextZ: number
  /** format / api hints for agents */
  apiVersion: number
}

export type TextExportBlockDto = {
  id: string
  type: ItemType
  containerId: string
  label: string
  text: string
}

/** board-ops API version — bump when tool contracts break. */
export const BOARD_OPS_API_VERSION = 1
