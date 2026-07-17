/**
 * Shared live-agent protocol (MCP ↔ Infinite Canvas app).
 *
 * Transport: files under the agent session directory (see agentPaths).
 * App heartbeats `session.json`; MCP drops `req-*.json` and waits for `res-*.json`.
 */

import type { BoardMetaDto } from './dto'
import type {
  CreateNoteInput,
  MoveItemsInput,
  UpdateTextInput,
  WriteOptions,
} from './types'

export const AGENT_PROTOCOL_VERSION = 1

export type AgentSessionFile = {
  protocolVersion: number
  pid: number
  /** Epoch ms — MCP treats session dead if older than ~8s */
  aliveAt: number
  appName: string
  boardPath: string | null
  boardName: string
  currentContainerId: string
  allowAgentWrite: boolean
  /** App store dirty (needs user Save) */
  dirty: boolean
  /** Monotonic revision after agent/user mutations */
  revision: number
  itemCount: number
  stackCount: number
}

export type CreateLinkInput = {
  containerId: string
  x: number
  y: number
  url: string
  title?: string
  description?: string
  width?: number
  height?: number
  clientRequestId?: string
}

export type CreateStackInput = {
  parentId: string
  x: number
  y: number
  name?: string
  width?: number
  height?: number
  clientRequestId?: string
}

export type MoveToContainerInput = {
  itemIds: string[]
  containerId: string
  /** Optional absolute poses after move (same order as itemIds subset). */
  layout?: Array<{ id: string; x: number; y: number }>
}

export type LayoutGridInput = {
  itemIds: string[]
  originX: number
  originY: number
  columns?: number
  gapX?: number
  gapY?: number
  cellWidth?: number
  cellHeight?: number
}

export type CreateImageInput = {
  containerId: string
  x: number
  y: number
  /** data: URL or runtime src (blob after hydrate) */
  src: string
  fileName?: string
  width?: number
  height?: number
  naturalWidth?: number
  naturalHeight?: number
  clientRequestId?: string
  /** Optional base64 asset to merge into packedAssets on file-mode save */
  assetBase64?: string
  assetMime?: string
}

export type ResearchClusterInput = {
  /** Parent container for the new stack (usually root) */
  parentId?: string
  title: string
  x?: number
  y?: number
  notes?: Array<{ content: string; kind?: 'textcard' | 'text' }>
  links?: Array<{ url: string; title?: string; description?: string }>
  images?: Array<{
    /** Prefer https URL — live/file backends download when possible */
    url?: string
    /** Or pre-fetched data URL */
    dataUrl?: string
    fileName?: string
    caption?: string
  }>
  columns?: number
  dryRun?: boolean
  /** Idempotent cluster stack id */
  clientRequestId?: string
  /**
   * When true (default), failed image downloads are skipped with warnings
   * instead of aborting the whole cluster.
   */
  skipInvalidImages?: boolean
}

export type AgentOp =
  | { op: 'ping' }
  | { op: 'get_meta' }
  | { op: 'get_viewport' }
  | { op: 'tree'; containerId?: string; depth?: number }
  | {
      op: 'list_items'
      containerId: string
      type?: string | string[]
      limit?: number
      offset?: number
    }
  | { op: 'get_item'; id: string }
  | { op: 'get_stack'; id: string }
  | {
      op: 'export_text'
      containerId: string
      ids?: string[]
      maxCharsPerItem?: number
    }
  | {
      op: 'search'
      query: string
      containerId?: string
      type?: string | string[]
      limit?: number
    }
  | { op: 'create_note'; input: CreateNoteInput; options?: WriteOptions }
  | { op: 'create_notes'; notes: CreateNoteInput[]; options?: WriteOptions }
  | { op: 'update_text'; input: UpdateTextInput; options?: WriteOptions }
  | { op: 'move_items'; input: MoveItemsInput; options?: WriteOptions }
  | { op: 'create_link'; input: CreateLinkInput; options?: WriteOptions }
  | { op: 'create_stack'; input: CreateStackInput; options?: WriteOptions }
  | { op: 'rename_stack'; id: string; name: string; options?: WriteOptions }
  | {
      op: 'move_to_container'
      input: MoveToContainerInput
      options?: WriteOptions
    }
  | { op: 'layout_grid'; input: LayoutGridInput; options?: WriteOptions }
  | { op: 'create_image'; input: CreateImageInput; options?: WriteOptions }
  | {
      op: 'add_research_cluster'
      input: ResearchClusterInput
      options?: WriteOptions
    }

export type AgentRequest = {
  protocolVersion: number
  id: string
  createdAt: number
  body: AgentOp
}

export type AgentResponse = {
  protocolVersion: number
  id: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string; detail?: string }
}

export type ViewportInfo = {
  viewport: { x: number; y: number; zoom: number }
  /** Approximate world rect of the window */
  worldRect: {
    x: number
    y: number
    width: number
    height: number
  }
  screen: { width: number; height: number }
  currentContainerId: string
}

export type MutationApplyResult = {
  createdIds: string[]
  createdStackIds?: string[]
  changedIds: string[]
  dryRun: boolean
  dirty: boolean
  meta?: BoardMetaDto
  /** Extra fields for cluster etc. */
  stackId?: string
  itemIds?: string[]
  warnings?: string[]
  revision?: number
  persisted?: 'live' | 'memory' | 'disk'
  visibleInLiveBoard?: boolean
  pendingUserSave?: boolean
  autoSaved?: boolean
  verified?: { items: string[]; stacks: string[] }
  ok?: boolean
}
