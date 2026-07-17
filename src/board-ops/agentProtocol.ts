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
  /**
   * Temporary label only. OG fetch will replace title/description/image unless
   * `lockTitle` is true. Prefer putting agent commentary in `annotation` (cluster)
   * or a separate floating text item — not as the link card title.
   */
  title?: string
  description?: string
  /**
   * When true, keep provided title and mark preview complete (skip OG title).
   * Default false so link cards get real site previews.
   */
  lockTitle?: boolean
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

export type ResearchClusterNote = {
  content: string
  /** Prefer role for mood boards; kind overrides when explicit */
  kind?: 'textcard' | 'text'
  /** title | subtitle | keyword | body — drives floating text vs note + size */
  role?: 'title' | 'subtitle' | 'keyword' | 'body'
  fontSize?: number
  color?: string
  fontWeight?: number
  width?: number
  height?: number
  autoSize?: boolean
  /** Optional association key for mood layout (group with matching images/links) */
  group?: string
}

export type ResearchClusterLink = {
  url: string
  /**
   * Agent commentary — rendered as floating text **above** the link card
   * (left-aligned). Not used as the OG link title.
   */
  annotation?: string
  /** @deprecated Prefer annotation; still accepted as annotation if annotation omitted */
  title?: string
  description?: string
  group?: string
}

export type ResearchClusterImage = {
  /** Prefer https URL — live/file backends download when possible */
  url?: string
  /** Or pre-fetched data URL */
  dataUrl?: string
  fileName?: string
  caption?: string
  group?: string
  /** Preferred display width (default ~480, aspect preserved) */
  width?: number
  naturalWidth?: number
  naturalHeight?: number
}

export type ResearchClusterSection = {
  heading?: string
  notes?: ResearchClusterNote[]
  links?: ResearchClusterLink[]
  images?: ResearchClusterImage[]
}

export type ResearchClusterInput = {
  /** Parent container for the new stack (usually root) */
  parentId?: string
  /**
   * Stack folder name when **creating**. Optional when appending via `stackId`
   * or reusing `clientRequestId` of an existing stack.
   */
  title?: string
  x?: number
  y?: number
  notes?: ResearchClusterNote[]
  links?: ResearchClusterLink[]
  images?: ResearchClusterImage[]
  /**
   * Explicit thematic blocks (preferred for rich mood boards).
   * When set, top-level notes/links/images are still placed in a header/body
   * then each section is laid out as a related vignette.
   */
  sections?: ResearchClusterSection[]
  /**
   * `mood` (default): relational multi-column vignettes.
   * `grid`: legacy uniform grid.
   */
  layout?: 'mood' | 'grid'
  columns?: number
  dryRun?: boolean
  /**
   * Stable stack id. If a stack with this id already exists, content is
   * **appended** (progressive write) instead of no-op.
   */
  clientRequestId?: string
  /**
   * Append into this existing stack (progressive streaming).
   * Prefer this after the first write returns `createdStackIds[0]`.
   */
  stackId?: string
  /** Gap below existing content when appending (default 80). */
  appendGap?: number
  /**
   * When true (default), failed image downloads are skipped with warnings
   * instead of aborting the whole cluster.
   */
  skipInvalidImages?: boolean
  /**
   * Live: enter the stack after apply and stay inside (default true).
   */
  enterStack?: boolean
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
