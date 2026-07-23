import type { BoardSnapshot, CanvasItem, Point, StackRecord, Tool, Viewport } from '../types/canvas'
import type { LayoutTarget } from '../utils/layout'
import type { HistoryEntry, ItemPatchOptions, StackEnterAnim } from './types'

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

export const FONT_STACKS = [
  { id: 'outfit', label: 'Outfit', value: '"Outfit", system-ui, sans-serif' },
  { id: 'fraunces', label: 'Fraunces', value: '"Fraunces", Georgia, serif' },
  { id: 'system', label: 'System', value: 'system-ui, Segoe UI, sans-serif' },
  { id: 'mono', label: 'Mono', value: 'ui-monospace, Consolas, monospace' },
  { id: 'georgia', label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
] as const

export interface CanvasState {
  items: CanvasItem[]
  /** Nested stack folders (enterable canvases) */
  stacks: StackRecord[]
  /** Active canvas container (`root` or stack id) */
  currentContainerId: string
  /** Viewport remembered for the home (root) canvas */
  homeViewport: Viewport
  selectedIds: string[]
  /** Selected stack folder ids on the current canvas */
  selectedStackIds: string[]
  tool: Tool
  viewport: Viewport
  nextZ: number
  spaceHeld: boolean
  cHeld: boolean
  isPanning: boolean
  scribbleColor: string
  scribbleWidth: number
  eraseWidth: number
  activeScribbleId: string | null
  boardName: string
  /** Absolute path of the open .icanvas file, if any */
  boardFilePath: string | null
  /** True when canvas has unsaved changes */
  dirty: boolean
  /** Monotonic revision for MCP read-after-write / live session */
  agentRevision: number
  animating: boolean
  /** Item currently in inline edit mode (text / textcard) */
  editingId: string | null
  /** Stack folder tab name being edited (stack id) */
  editingStackGroupId: string | null
  /** Snap selection edges to nearby item edges while moving */
  snapEnabled: boolean
  /** Hide left/right docks (Ctrl+F); top style bar stays when relevant */
  immersiveMode: boolean
  /** True while pack+write is in progress (progress toast) */
  isSaving: boolean
  /** Ephemeral UI notice after save (auto-cleared by SaveToast) */
  saveNotice: string | null
  /** Bumps so the same message still retriggers the toast */
  saveNoticeSeq: number
  /** Enter-stack folder expand animation (screen space) */
  stackEnterAnim: StackEnterAnim | null
  /** Pending navigation target after current exit animation finishes (multi-level jump) */
  pendingNavigation: string | null
  history: HistoryEntry[]
  future: HistoryEntry[]

  setTool: (tool: Tool) => void
  setEditingId: (id: string | null) => void
  setEditingStackGroupId: (groupId: string | null) => void
  /** Rename a stack folder tab */
  commitStackName: (groupId: string, name: string) => void
  setSaving: (saving: boolean) => void
  flashSaveNotice: (message?: string) => void
  clearSaveNotice: () => void
  setImmersiveMode: (on: boolean) => void
  toggleImmersiveMode: () => void
  setViewport: (viewport: Partial<Viewport>) => void
  panBy: (dx: number, dy: number) => void
  zoomAt: (screenX: number, screenY: number, factor: number) => void
  resetView: () => void
  setSpaceHeld: (held: boolean) => void
  setCHeld: (held: boolean) => void
  setIsPanning: (panning: boolean) => void
  setScribbleStyle: (color?: string, width?: number) => void
  setEraseWidth: (width: number) => void
  setSnapEnabled: (enabled: boolean) => void
  toggleSnap: () => void

  select: (ids: string[], additive?: boolean) => void
  selectStacks: (ids: string[], additive?: boolean) => void
  /** Select free items + nested stacks together and raise both to front */
  selectBodies: (itemIds: string[], stackIds: string[]) => void
  clearSelection: () => void
  toggleSelect: (id: string) => void
  selectAll: () => void
  /** Items on the active canvas */
  getVisibleItems: () => CanvasItem[]
  getVisibleStacks: () => StackRecord[]
  getBreadcrumb: () => Array<{ id: string; name: string }>
  /**
   * Enter a nested stack canvas. `screenRect` is the folder in screen pixels
   * for the expand animation.
   */
  enterStack: (
    stackId: string,
    screenRect?: { x: number; y: number; w: number; h: number },
  ) => void
  /**
   * Navigate to a container on the path (`root` or stack id).
   * Multi-level jumps play **one** exit animation from the current level, then
   * silently fold intermediate parents so fans stay correct without stepwise UX.
   * `animate: false` applies gather handoff with no RAF (used for the silent tail).
   */
  navigateToContainer: (
    containerId: string,
    options?: { animate?: boolean },
  ) => void
  /**
   * Deep-clone free items and/or stack trees (with remapped ids).
   * Returns new free item ids + top-level stack ids. Does not push history.
   */
  duplicateBodies: (
    itemIds: string[],
    stackIds: string[],
  ) => { itemIds: string[]; stackIds: string[] }
  setStackEnterAnim: (anim: StackEnterAnim | null) => void
  updateStacks: (
    patches: Array<{ id: string; patch: Partial<StackRecord> }>,
  ) => void
  moveStacks: (ids: string[], dx: number, dy: number) => void

  addItems: (items: CanvasItem[], select?: boolean) => void
  /**
   * Patch one item. Options control dirty flag and optional history push.
   * Prefer `useHistoryOnce` for continuous gestures instead of `history: true` each frame.
   */
  updateItem: (
    id: string,
    patch: Partial<CanvasItem>,
    options?: ItemPatchOptions,
  ) => void
  updateItems: (
    patches: Array<{ id: string; patch: Partial<CanvasItem> }>,
    options?: ItemPatchOptions,
  ) => void
  moveItems: (ids: string[], dx: number, dy: number) => void
  resizeItem: (id: string, width: number, height: number, x?: number, y?: number) => void
  deleteSelected: () => void
  bringToFront: (ids?: string[]) => void
  sendToBack: (ids?: string[]) => void
  /** Deep-clone items; returns new ids in the same order. Does not push history. */
  duplicateItems: (ids: string[]) => string[]
  /** Copy selection into the in-app clipboard (Ctrl+C) */
  copySelection: () => boolean
  /** Cut selection into the in-app clipboard (Ctrl+X) — remove from canvas */
  cutSelection: () => boolean
  /**
   * Paste clipboard into the current container (Ctrl+V).
   * Returns true if something was pasted (so OS paste can be skipped).
   */
  pasteClipboard: () => boolean
  /** Whether the in-app clipboard has content */
  hasClipboard: () => boolean
  /** Clear the in-app clipboard (e.g. on window blur so external copies take priority) */
  clearClipboard: () => void

  addText: (world: Point, options?: { content?: string; width?: number; height?: number }) => void
  addTextCard: (
    world: Point,
    options?: { content?: string; width?: number; height?: number },
  ) => void
  addLinkCard: (world: Point, url?: string) => void
  addEmbed: (
    world: Point,
    data: { html: string; src: string; width: number; height: number; title?: string },
  ) => void
  /** Convert free text → note for selected (or given) free items */
  convertTextKind: (to: 'text' | 'textcard', ids?: string[]) => void
  /**
   * Begin a stroke in the current scribble layer session.
   * Creates a new layer on first stroke; further strokes append paths
   * until the scribble tool is left or the layer is finalized.
   */
  startScribble: (world: Point) => string
  appendScribblePoint: (id: string, world: Point) => void
  /**
   * End the current stroke (pointer up). Does NOT close the layer session —
   * more strokes still go into the same scribble item.
   */
  endScribble: () => void
  /** Close the active scribble layer session (e.g. leaving the pen tool). */
  finalizeScribbleLayer: () => void
  /** Double-click a scribble to reopen it for more strokes. */
  enterScribbleEdit: (id: string) => void
  eraseAt: (world: Point, radius?: number) => void
  /**
   * Axis-aligned crop for one or more free media (image/gif/video).
   * Rotated items are skipped. Returns how many items were cropped.
   */
  applyCrop: (
    ids: string | string[],
    worldRect: { x: number; y: number; width: number; height: number },
  ) => number
  restoreCrop: (ids?: string[]) => void
  /** Reset rotation of selected free items to 0° (Alt+R) */
  restoreRotation: (ids?: string[]) => void
  /**
   * Restore selected media display size to source natural pixels
   * (current crop region), keeping center fixed (Alt+S).
   */
  restoreNativeScale: (ids?: string[]) => void

  /** Align selected bodies (stack = one unit) */
  alignSelected: (mode: import('../utils/align').AlignMode) => void
  /** Pack selected bodies toward a side */
  packSelected: (dir: import('../utils/align').PackDir) => void
  /** Toggle flipX / flipY on selected image | gif | video */
  flipSelectedMedia: (axis: 'x' | 'y') => void

  pushHistory: () => void
  undo: () => void
  redo: () => void

  animateToLayout: (
    targets: LayoutTarget[],
    durationMs?: number,
    options?: {
      stackGroupId?: string
      unstack?: boolean
      /** After fan layout, reparent into enterable nested stack (keep fan as parent preview) */
      nestInto?: { parentId: string }
      /** Skip history push (for chained enter/exit/dissolve animations) */
      skipHistory?: boolean
      /**
       * Start even if `animating` is already true (stack enter locks interaction
       * before driving the fan→free layout).
       */
      force?: boolean
      onComplete?: () => void
    },
  ) => void
  quickStack: () => void
  smoothLayout: (columns?: number) => void
  rowLayout: () => void
  /**
   * Merge free (non-stacked) items into an existing stack on top.
   * Animates into the stack fan layout.
   */
  mergeIntoStack: (itemIds: string[], groupId: string) => void
  /** Dissolve selected stack folders back onto the current canvas */
  dissolveSelectedStacks: () => void

  getSelectedItems: () => CanvasItem[]
  exportBoard: () => BoardSnapshot
  importBoard: (board: BoardSnapshot) => void
  markDirty: () => void
  clearDirty: () => void
  setBoardFilePath: (path: string | null) => void
  setBoardName: (name: string) => void
}

export type GetState = () => CanvasState
export type SetState = (
  partial: Partial<CanvasState> | ((state: CanvasState) => Partial<CanvasState>),
) => void
