import { create } from 'zustand'
import type {
  BoardSnapshot,
  CanvasItem,
  CropRect,
  LinkCardItem,
  Point,
  ScribbleItem,
  ScribblePath,
  StackRecord,
  TextCardItem,
  TextItem,
  EmbedItem,
  Tool,
  Viewport,
} from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { uid } from '../utils/id'
import {
  allContentBounds,
  computeQuickStack,
  computeQuickStackBodies,
  computeRowLayout,
  computeSmoothLayout,
  computeTightLayout,
  stackGroupBounds,
  STACK_FOLDER_PAD,
  type LayoutTarget,
} from '../utils/layout'
import {
  allocateStackZBlock,
  buildRaiseZMap,
  freezeStackSurfaceZ,
  nestedStackUnitMaxZ,
  raiseSelectionZ,
} from '../utils/zOrder'
import {
  asFreeOnContainer,
  collectDescendantStackIds,
  containerOf,
  countLeafItemsInStack,
  createStackRecord,
  folderBoundsFromFan,
  freeFanRelFromLocalFan,
  itemsInContainer,
  migrateLegacyStacks,
  resolveNestedFreeFan,
  stackDisplayName,
  stackPath,
  stacksInContainer,
  withViewport,
} from '../utils/stacks'
import { faviconFor, guessTitleFromUrl, normalizeUrl } from '../utils/linkMeta'
import { eraseFromPaths, recomputeScribbleBounds } from '../utils/scribble'
import { applyWorldCrop } from '../utils/crop'
import {
  computeAlignPatches,
  computePackPatches,
  type AlignMode,
  type PackDir,
} from '../utils/align'

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

const FONT_STACKS = [
  { id: 'outfit', label: 'Outfit', value: '"Outfit", system-ui, sans-serif' },
  { id: 'fraunces', label: 'Fraunces', value: '"Fraunces", Georgia, serif' },
  { id: 'system', label: 'System', value: 'system-ui, Segoe UI, sans-serif' },
  { id: 'mono', label: 'Mono', value: 'ui-monospace, Consolas, monospace' },
  { id: 'georgia', label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
] as const

export { FONT_STACKS }

interface HistoryEntry {
  items: CanvasItem[]
  stacks: StackRecord[]
  nextZ: number
  currentContainerId: string
}

/** Screen-space folder morph for enter (expand) / exit (shrink + settle) */
export interface StackEnterAnim {
  stackId: string
  /** enter: folder→screen; exit: screen→folder then settle onto real chrome */
  mode: 'enter' | 'exit'
  /** Screen-space rect at t=0 */
  start: { x: number; y: number; w: number; h: number }
  /** Screen-space rect at t=1 (defaults to fullscreen for enter) */
  end?: { x: number; y: number; w: number; h: number }
  /** 0..1 morph progress */
  t: number
  /**
   * Exit only: after morph, crossfade overlay → real StackFolder (0..1).
   * Real folder fades in while overlay fades out — no pop-in.
   */
  settle?: number
  /**
   * Parent-canvas peer visibility (0 = hidden, 1 = full).
   * Exit: 0 → 1 (fade in, starts ~200ms after exit begins).
   * Enter: 1 → 0 (fade out, reverse of exit appear curve).
   */
  peerReveal?: number
  /**
   * Nested child-stack folder chrome opacity while entering/exiting this stack.
   * Exit: 1 → 0 (B folder dissolves into the fan). Enter: 0 → 1 (B reappears).
   */
  nestedChromeOpacity?: number
  /**
   * Enter only: nested-stack leaf cards animating on the parent stack canvas
   * (fan → free pose inside nested folder) while nested chrome fades in.
   */
  nestedLeafAnims?: Array<{
    id: string
    start: { x: number; y: number; rotation: number }
    end: { x: number; y: number; rotation: number }
    width: number
    height: number
    zIndex: number
  }>
  /** Folder tab label (empty = compact tab) */
  name?: string
  /** Count badge on folder */
  memberCount?: number
  /**
   * Exit only: container the path should show during the exit anim
   * (parent/home). Breadcrumb switches immediately; canvas handoff stays later.
   */
  targetContainerId?: string
}

interface CanvasState {
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
  animating: boolean
  /** Item currently in inline edit mode (text / textcard) */
  editingId: string | null
  /** Stack folder tab name being edited (stack id) */
  editingStackGroupId: string | null
  /** Snap selection edges to nearby item edges while moving */
  snapEnabled: boolean
  /** Hide left/right docks (Ctrl+F); top style bar stays when relevant */
  immersiveMode: boolean
  /** Ephemeral UI notice after save (auto-cleared by SaveToast) */
  saveNotice: string | null
  /** Bumps so the same message still retriggers the toast */
  saveNoticeSeq: number
  /** Enter-stack folder expand animation (screen space) */
  stackEnterAnim: StackEnterAnim | null
  history: HistoryEntry[]
  future: HistoryEntry[]

  setTool: (tool: Tool) => void
  setEditingId: (id: string | null) => void
  setEditingStackGroupId: (groupId: string | null) => void
  /** Rename a stack folder tab */
  commitStackName: (groupId: string, name: string) => void
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
  /** Navigate to a container on the path (`root` or stack id) */
  navigateToContainer: (containerId: string) => void
  setStackEnterAnim: (anim: StackEnterAnim | null) => void
  updateStacks: (
    patches: Array<{ id: string; patch: Partial<StackRecord> }>,
  ) => void
  moveStacks: (ids: string[], dx: number, dy: number) => void

  addItems: (items: CanvasItem[], select?: boolean) => void
  updateItem: (id: string, patch: Partial<CanvasItem>) => void
  updateItems: (patches: Array<{ id: string; patch: Partial<CanvasItem> }>) => void
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
  /** Convert free text ↔ note for selected (or given) free items */
  convertTextKind: (to: 'text' | 'textcard', ids?: string[]) => void
  startScribble: (world: Point) => string
  appendScribblePoint: (id: string, world: Point) => void
  endScribble: () => void
  eraseAt: (world: Point, radius?: number) => void
  applyCrop: (
    id: string,
    worldRect: { x: number; y: number; width: number; height: number },
  ) => void
  restoreCrop: (ids?: string[]) => void

  /** Align selected bodies (stack = one unit) */
  alignSelected: (mode: import('../utils/align').AlignMode) => void
  /** Pack / 靠拢 selected bodies toward a side */
  packSelected: (dir: import('../utils/align').PackDir) => void

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

function cloneItems(items: CanvasItem[]): CanvasItem[] {
  return structuredClone(items)
}

function cloneStacks(stacks: StackRecord[]): StackRecord[] {
  return structuredClone(stacks)
}

/** In-app cut/copy buffer (not the OS clipboard) */
type CanvasClipboard = {
  mode: 'copy' | 'cut'
  items: CanvasItem[]
  stacks: StackRecord[]
  /** Container the free/top-level bodies came from */
  sourceContainerId: string
}

let canvasClipboard: CanvasClipboard | null = null

/**
 * Snapshot selection for cut/copy: free items + selected stacks (with full trees).
 * Free items that already live inside a selected stack are not double-included.
 */
function snapshotSelection(state: {
  items: CanvasItem[]
  stacks: StackRecord[]
  selectedIds: string[]
  selectedStackIds: string[]
  currentContainerId: string
}): CanvasClipboard | null {
  const { items, stacks, selectedIds, selectedStackIds, currentContainerId } =
    state
  if (selectedIds.length === 0 && selectedStackIds.length === 0) return null

  const stackIds = new Set<string>()
  for (const sid of selectedStackIds) {
    for (const id of collectDescendantStackIds(stacks, sid)) {
      stackIds.add(id)
    }
  }

  const itemIds = new Set<string>()
  for (const id of selectedIds) {
    const it = items.find((i) => i.id === id)
    if (!it) continue
    // Skip free items that are already inside a selected stack tree
    if (stackIds.has(containerOf(it))) continue
    itemIds.add(id)
  }
  // All items living in the selected stack tree
  for (const it of items) {
    if (stackIds.has(containerOf(it))) itemIds.add(it.id)
  }

  if (itemIds.size === 0 && stackIds.size === 0) return null

  const clipItems = items
    .filter((i) => itemIds.has(i.id))
    .map((i) => structuredClone(i) as CanvasItem)
  const clipStacks = stacks
    .filter((s) => stackIds.has(s.id))
    .map((s) => structuredClone(s) as StackRecord)

  return {
    mode: 'copy',
    items: clipItems,
    stacks: clipStacks,
    sourceContainerId: currentContainerId,
  }
}

/** Strip same-canvas stack chrome so pasted free items sit cleanly on the target */
function asPasteFreeItem(item: CanvasItem, containerId: string): CanvasItem {
  const {
    stacked: _s,
    stackGroupId: _g,
    stackName: _n,
    stackPreview: _p,
    ...rest
  } = item
  return tagContainer(rest as CanvasItem, containerId)
}

function tagContainer<T extends CanvasItem>(
  item: T,
  containerId: string,
): T {
  if (containerId === ROOT_CONTAINER_ID) {
    if (!item.containerId || item.containerId === ROOT_CONTAINER_ID) return item
    const { containerId: _c, ...rest } = item
    return rest as T
  }
  return { ...item, containerId }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** Measure note card height for a fixed width (wrap + label + padding). */
function measureNoteCardHeight(
  content: string,
  width: number,
  fontSize: number,
): number {
  // Matches .notion-card: padding 12+18, gap 8, label ~18, body line-height 1.5
  const padX = 28
  const padTop = 12
  const padBottom = 18
  const gap = 8
  const labelH = 18
  const minH = 80
  const maxH = 900
  const bodyWidth = Math.max(40, width - padX)
  if (typeof document === 'undefined') {
    const lines = content.split(/\r?\n/)
    let count = 0
    const maxChars = Math.max(8, Math.floor(bodyWidth / (fontSize * 0.55)))
    for (const line of lines) {
      count += Math.max(1, Math.ceil(Math.max(1, line.length) / maxChars))
    }
    return Math.max(
      minH,
      Math.min(
        maxH,
        padTop + padBottom + gap + labelH + count * fontSize * 1.5 + 4,
      ),
    )
  }
  const el = document.createElement('div')
  el.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    'visibility:hidden',
    `width:${bodyWidth}px`,
    `font-size:${fontSize}px`,
    'line-height:1.5',
    'white-space:pre-wrap',
    'word-break:break-word',
    'overflow-wrap:anywhere',
    'font-family:var(--font-ui),system-ui,sans-serif',
  ].join(';')
  el.textContent = content
  document.body.appendChild(el)
  const bodyH = el.scrollHeight
  el.remove()
  return Math.max(
    minH,
    Math.min(maxH, padTop + padBottom + gap + labelH + bodyH + 6),
  )
}

/** Migrate old boards where type 'text' was a card (no fontFamily) */
function normalizeImportedItems(items: CanvasItem[]): CanvasItem[] {
  return items.map((raw) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = raw as any
    if (item?.type === 'text' && typeof item.content === 'string' && !item.fontFamily) {
      return {
        id: item.id,
        type: 'textcard',
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation ?? 0,
        zIndex: item.zIndex ?? 1,
        content: item.content,
        fontSize: item.fontSize ?? 14,
        color: item.color ?? '#ebe6dc',
        backgroundColor: item.backgroundColor ?? '#1c1f28',
      } as TextCardItem
    }
    return raw
  })
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  items: [],
  stacks: [],
  currentContainerId: ROOT_CONTAINER_ID,
  homeViewport: { ...DEFAULT_VIEWPORT },
  selectedIds: [],
  selectedStackIds: [],
  tool: 'select',
  viewport: { ...DEFAULT_VIEWPORT },
  nextZ: 1,
  spaceHeld: false,
  cHeld: false,
  isPanning: false,
  scribbleColor: '#0d99ff',
  scribbleWidth: 3,
  eraseWidth: 18,
  activeScribbleId: null,
  boardName: 'Untitled Board',
  boardFilePath: null,
  dirty: false,
  animating: false,
  editingId: null,
  editingStackGroupId: null,
  snapEnabled: true,
  immersiveMode: false,
  saveNotice: null,
  saveNoticeSeq: 0,
  stackEnterAnim: null,
  history: [],
  future: [],

  setTool: (tool) => set({ tool, editingId: null, editingStackGroupId: null }),
  setEditingId: (id) => set({ editingId: id, editingStackGroupId: null }),
  setEditingStackGroupId: (groupId) =>
    set({ editingStackGroupId: groupId, editingId: null }),
  flashSaveNotice: (message = 'Saved') =>
    set((s) => ({
      saveNotice: message,
      saveNoticeSeq: s.saveNoticeSeq + 1,
    })),
  clearSaveNotice: () => set({ saveNotice: null }),
  setImmersiveMode: (on) => set({ immersiveMode: on }),
  toggleImmersiveMode: () => set((s) => ({ immersiveMode: !s.immersiveMode })),
  setStackEnterAnim: (anim) => set({ stackEnterAnim: anim }),
  commitStackName: (groupId, name) => {
    const trimmed = name.trim()
    const stack = get().stacks.find((s) => s.id === groupId)
    if (stack) {
      const prev = (stack.name || '').trim()
      if (prev === trimmed) {
        set({ editingStackGroupId: null })
        return
      }
      get().pushHistory()
      set((s) => ({
        editingStackGroupId: null,
        dirty: true,
        stacks: s.stacks.map((st) =>
          st.id === groupId ? { ...st, name: trimmed } : st,
        ),
      }))
      return
    }
    // Legacy: name written onto stacked members
    const members = get().items.filter(
      (i) => i.stacked && i.stackGroupId === groupId,
    )
    if (members.length === 0) {
      set({ editingStackGroupId: null })
      return
    }
    const prev = (members[0].stackName || '').trim()
    if (prev === trimmed) {
      set({ editingStackGroupId: null })
      return
    }
    get().pushHistory()
    set((s) => ({
      editingStackGroupId: null,
      dirty: true,
      items: s.items.map((item) => {
        if (!(item.stacked && item.stackGroupId === groupId)) return item
        if (trimmed) return { ...item, stackName: trimmed }
        const { stackName: _n, ...rest } = item
        return rest as CanvasItem
      }),
    }))
  },
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

  setViewport: (viewport) =>
    set((s) => ({ viewport: { ...s.viewport, ...viewport } })),

  panBy: (dx, dy) =>
    set((s) => ({
      viewport: { ...s.viewport, x: s.viewport.x + dx, y: s.viewport.y + dy },
    })),

  zoomAt: (screenX, screenY, factor) => {
    const { viewport } = get()
    const nextZoom = Math.min(8, Math.max(0.08, viewport.zoom * factor))
    const wx = (screenX - viewport.x) / viewport.zoom
    const wy = (screenY - viewport.y) / viewport.zoom
    set({
      viewport: {
        zoom: nextZoom,
        x: screenX - wx * nextZoom,
        y: screenY - wy * nextZoom,
      },
    })
  },

  resetView: () => {
    const s = get()
    const items = itemsInContainer(s.items, s.currentContainerId)
    const folderStacks = stacksInContainer(s.stacks, s.currentContainerId)
    if (items.length === 0 && folderStacks.length === 0) {
      set({ viewport: { ...DEFAULT_VIEWPORT } })
      return
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const itemBounds = allContentBounds(items)
    if (itemBounds) {
      minX = Math.min(minX, itemBounds.x)
      minY = Math.min(minY, itemBounds.y)
      maxX = Math.max(maxX, itemBounds.x + itemBounds.width)
      maxY = Math.max(maxY, itemBounds.y + itemBounds.height)
    }
    for (const st of folderStacks) {
      minX = Math.min(minX, st.x)
      minY = Math.min(minY, st.y)
      maxX = Math.max(maxX, st.x + st.width)
      maxY = Math.max(maxY, st.y + st.height)
    }
    if (!Number.isFinite(minX)) {
      set({ viewport: { ...DEFAULT_VIEWPORT } })
      return
    }
    const bounds = {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }

    const pad = 96
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900

    const zoom = Math.min(
      4,
      Math.max(
        0.08,
        Math.min((vw - pad * 2) / bounds.width, (vh - pad * 2) / bounds.height),
      ),
    )
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    set({
      viewport: {
        zoom,
        x: vw / 2 - cx * zoom,
        y: vh / 2 - cy * zoom,
      },
    })
  },

  setSpaceHeld: (held) => set({ spaceHeld: held }),
  setCHeld: (held) => set({ cHeld: held }),
  setIsPanning: (panning) => set({ isPanning: panning }),

  setScribbleStyle: (color, width) =>
    set((s) => ({
      scribbleColor: color ?? s.scribbleColor,
      scribbleWidth: width ?? s.scribbleWidth,
    })),

  setEraseWidth: (width) => set({ eraseWidth: width }),

  select: (ids, additive = false) =>
    set((s) => {
      let selectedIds: string[]
      if (additive) {
        const setIds = new Set(s.selectedIds)
        ids.forEach((id) => {
          if (setIds.has(id)) setIds.delete(id)
          else setIds.add(id)
        })
        selectedIds = [...setIds]
      } else {
        selectedIds = ids
      }

      if (selectedIds.length === 0) {
        return { selectedIds, editingId: null }
      }

      const isStackedId = (id: string) => {
        const it = s.items.find((i) => i.id === id)
        return !!(it?.stacked && it.stackGroupId)
      }

      // Single free click: that item becomes the top body; stacks stay atomic
      // (folder chrome reserved under members so notes cannot slip between).
      const promoteFreeId =
        ids.length === 1 &&
        selectedIds.includes(ids[0]) &&
        !isStackedId(ids[0])
          ? ids[0]
          : null

      const { zMap, nextZ } = buildRaiseZMap(s.items, selectedIds, s.nextZ, {
        promoteFreeId,
      })

      return {
        selectedIds,
        selectedStackIds: additive ? s.selectedStackIds : [],
        editingId: null,
        nextZ,
        items: s.items.map((item) =>
          zMap.has(item.id) ? { ...item, zIndex: zMap.get(item.id)! } : item,
        ),
      }
    }),

  clearSelection: () =>
    set({ selectedIds: [], selectedStackIds: [], editingId: null }),

  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
      selectedStackIds: [],
    })),

  selectStacks: (ids, additive = false) =>
    set((s) => {
      let selectedStackIds: string[]
      if (additive) {
        const setIds = new Set(s.selectedStackIds)
        ids.forEach((id) => {
          if (setIds.has(id)) setIds.delete(id)
          else setIds.add(id)
        })
        selectedStackIds = [...setIds]
      } else {
        selectedStackIds = ids
      }

      // Match free-item select: bring selected stack body (folder + fan) to front
      if (selectedStackIds.length === 0) {
        return {
          selectedStackIds,
          selectedIds: additive ? s.selectedIds : [],
          editingId: null,
        }
      }

      const freeIds = additive ? s.selectedIds : []
      const { itemZMap, stackZMap, nextZ } = raiseSelectionZ(
        s.items,
        s.stacks,
        freeIds,
        selectedStackIds,
        s.nextZ,
      )

      return {
        selectedStackIds,
        selectedIds: freeIds,
        editingId: null,
        nextZ,
        stacks: s.stacks.map((st) =>
          stackZMap.has(st.id) ? { ...st, zIndex: stackZMap.get(st.id)! } : st,
        ),
        items: s.items.map((item) =>
          itemZMap.has(item.id)
            ? { ...item, zIndex: itemZMap.get(item.id)! }
            : item,
        ),
      }
    }),

  selectBodies: (itemIds, stackIds) =>
    set((s) => {
      if (itemIds.length === 0 && stackIds.length === 0) {
        return {
          selectedIds: [],
          selectedStackIds: [],
          editingId: null,
        }
      }
      const { itemZMap, stackZMap, nextZ } = raiseSelectionZ(
        s.items,
        s.stacks,
        itemIds,
        stackIds,
        s.nextZ,
      )
      return {
        selectedIds: itemIds,
        selectedStackIds: stackIds,
        editingId: null,
        nextZ,
        stacks: s.stacks.map((st) =>
          stackZMap.has(st.id) ? { ...st, zIndex: stackZMap.get(st.id)! } : st,
        ),
        items: s.items.map((item) =>
          itemZMap.has(item.id)
            ? { ...item, zIndex: itemZMap.get(item.id)! }
            : item,
        ),
      }
    }),

  selectAll: () =>
    set((s) => ({
      selectedIds: itemsInContainer(s.items, s.currentContainerId).map(
        (i) => i.id,
      ),
      selectedStackIds: stacksInContainer(
        s.stacks,
        s.currentContainerId,
      ).map((st) => st.id),
    })),

  getVisibleItems: () => {
    const s = get()
    return itemsInContainer(s.items, s.currentContainerId)
  },

  getVisibleStacks: () => {
    const s = get()
    return stacksInContainer(s.stacks, s.currentContainerId)
  },

  getBreadcrumb: () => {
    const s = get()
    // Path: Home / stack / nested… (Untitled only as unnamed-stack label)
    const path = stackPath(s.stacks, s.currentContainerId)
    return [
      { id: ROOT_CONTAINER_ID, name: 'Home' },
      ...path.map((st) => ({
        id: st.id,
        name: stackDisplayName(st, 'Untitled'),
      })),
    ]
  },

  enterStack: (stackId, screenRect) => {
    const s = get()
    const stack = s.stacks.find((st) => st.id === stackId)
    if (!stack) return
    if (s.animating) return

    const parentVp = { ...s.viewport }

    // Persist viewport on the container we're leaving
    if (s.currentContainerId === ROOT_CONTAINER_ID) {
      set({ homeViewport: parentVp })
    } else {
      const cur = s.stacks.find((st) => st.id === s.currentContainerId)
      if (cur) {
        set({
          stacks: get().stacks.map((st) =>
            st.id === cur.id ? withViewport(st, parentVp) : st,
          ),
        })
      }
    }

    // Always drive folder expand anim (Space and double-click share this path)
    const members = itemsInContainer(s.items, stackId)
    const childStacks = stacksInContainer(s.stacks, stackId)
    const leafCount = countLeafItemsInStack(s.items, s.stacks, stackId)
    const enterRect =
      screenRect ??
      (() => {
        const vp = parentVp
        // Frameless window: surface origin ≈ (0,0)
        return {
          x: stack.x * vp.zoom + vp.x,
          y: stack.y * vp.zoom + vp.y,
          w: stack.width * vp.zoom,
          h: stack.height * vp.zoom,
        }
      })()
    // Final free layout inside stack (preserved across enter/exit)
    const ends: LayoutTarget[] = members.map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
      rotation: m.rotation ?? 0,
    }))
    // Start from fan poses: parent absolute → local (folder top-left origin)
    const starts = members.map((m) => {
      const px = m.stackPreview?.x ?? stack.x + STACK_FOLDER_PAD
      const py = m.stackPreview?.y ?? stack.y + STACK_FOLDER_PAD
      return {
        id: m.id,
        x: px - stack.x,
        y: py - stack.y,
        rotation: m.stackPreview?.rotation ?? 0,
      }
    })
    const startMap = new Map(starts.map((t) => [t.id, t]))

    // Continuous viewport: local (0,0) == parent (stack.x, stack.y) on screen
    // so fan cards don't jump when we switch into the stack.
    const continuousVp = {
      zoom: parentVp.zoom,
      x: parentVp.x + stack.x * parentVp.zoom,
      y: parentVp.y + stack.y * parentVp.zoom,
    }

    /*
     * Nested child stacks (B inside A):
     * - Free shell = stored B.x/y/w/h (never re-grown on parent enter)
     * - Free fan = freeFanRel cache (only recomputed when B itself is exited)
     * - Pile stackPreview is A-local *gather*; animate unit gather → free
     */
    type NestedEnterUnit = {
      stackId: string
      free: { x: number; y: number; width: number; height: number }
      start: { x: number; y: number; width: number; height: number }
      end: { x: number; y: number; width: number; height: number }
      /** Rigid offsets of leaves relative to unit top-left */
      rel: Array<{
        id: string
        dx: number
        dy: number
        rotation: number
      }>
      /** Persist freeFanRel after enter if cache was missing */
      freeFanRelToPersist?: Array<{
        id: string
        dx: number
        dy: number
        rotation: number
      }>
    }
    const nestedEnterUnits: NestedEnterUnit[] = []
    for (const cs of childStacks) {
      const nestedMembers = itemsInContainer(s.items, cs.id)
      if (nestedMembers.length === 0) continue
      // Do NOT prefer stackPreview here — after exit-A it is gather, not free
      // Pass stacks so freeFanRel includes deep leaves (C under B)
      const resolved = resolveNestedFreeFan(cs, s.items, {
        stacks: s.stacks,
      })
      const free = { ...resolved.bounds }
      const rel = resolved.rel.map((r) => ({
        id: r.id,
        dx: r.dx,
        dy: r.dy,
        rotation: r.rotation,
      }))
      // Start = visual unit origin from free members' gather previews + freeFanRel
      const directWithPreview = nestedMembers.filter((m) => m.stackPreview)
      let start: { x: number; y: number; width: number; height: number } = {
        ...free,
      }
      if (directWithPreview.length > 0 && rel.length > 0) {
        const relById = new Map(rel.map((r) => [r.id, r]))
        for (const m of directWithPreview) {
          const r = relById.get(m.id)
          if (!r || !m.stackPreview) continue
          start = {
            x: m.stackPreview.x - r.dx,
            y: m.stackPreview.y - r.dy,
            width: free.width,
            height: free.height,
          }
          break
        }
      }
      nestedEnterUnits.push({
        stackId: cs.id,
        free,
        start,
        end: { ...free },
        rel,
        freeFanRelToPersist: resolved.needsPersist
          ? resolved.rel.map((r) => ({ ...r }))
          : undefined,
      })
    }
    const nestedEnterById = new Map(
      nestedEnterUnits.map((u) => [u.stackId, u]),
    )
    const nestedLeafIds = new Set(
      nestedEnterUnits.flatMap((u) => u.rel.map((r) => r.id)),
    )

    set({
      currentContainerId: stackId,
      selectedIds: [],
      selectedStackIds: [],
      editingId: null,
      editingStackGroupId: null,
      items: s.items.map((item) => {
        const t = startMap.get(item.id)
        if (t) {
          return { ...item, x: t.x, y: t.y, rotation: t.rotation ?? 0 }
        }
        // Nested unit leaves: direct members of B get parent-abs (A-local);
        // deeper (C) keep B-local offsets so B.x + preview stays correct on A.
        if (nestedLeafIds.has(item.id)) {
          for (const u of nestedEnterUnits) {
            const r = u.rel.find((x) => x.id === item.id)
            if (!r) continue
            const direct = containerOf(item) === u.stackId
            return {
              ...item,
              stackPreview: direct
                ? {
                    x: u.start.x + r.dx,
                    y: u.start.y + r.dy,
                    rotation: r.rotation,
                  }
                : {
                    x: r.dx,
                    y: r.dy,
                    rotation: r.rotation,
                  },
            }
          }
        }
        return item
      }),
      stacks: s.stacks.map((st) => {
        const u = nestedEnterById.get(st.id)
        if (!u) return st
        // Start at gather place; free origin restored as anim runs to end
        return {
          ...st,
          x: u.start.x,
          y: u.start.y,
          width: u.start.width,
          height: u.start.height,
        }
      }),
      viewport: continuousVp,
      // Lock interaction for the whole enter (layout + morph + peer fade)
      animating: true,
      stackEnterAnim: {
        stackId,
        mode: 'enter',
        start: enterRect,
        t: 0,
        nestedChromeOpacity: 0,
        // Parent peers start fully visible and fade out (see InfiniteCanvas enter tick)
        peerReveal: 1,
        name: (stack.name || '').trim(),
        memberCount: leafCount,
      },
    })

    // Target viewport: fit free layout (zoom in as cards spread)
    const endMap = new Map(ends.map((t) => [t.id, t]))
    const boundsList: Array<{
      x: number
      y: number
      width: number
      height: number
    }> = []
    for (const m of members) {
      const e = endMap.get(m.id) ?? { x: m.x, y: m.y }
      boundsList.push({
        x: e.x,
        y: e.y,
        width: m.width,
        height: m.height,
      })
    }
    for (const cs of childStacks) {
      boundsList.push({
        x: cs.x,
        y: cs.y,
        width: cs.width,
        height: cs.height,
      })
    }
    let fitVp = continuousVp
    if (boundsList.length) {
      const minX = Math.min(...boundsList.map((b) => b.x))
      const minY = Math.min(...boundsList.map((b) => b.y))
      const maxX = Math.max(...boundsList.map((b) => b.x + b.width))
      const maxY = Math.max(...boundsList.map((b) => b.y + b.height))
      const bw = Math.max(1, maxX - minX)
      const bh = Math.max(1, maxY - minY)
      const pad = 80
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
      const vh = typeof window !== 'undefined' ? window.innerHeight : 900
      const zoom = Math.min(
        1.2,
        Math.max(0.15, Math.min((vw - pad * 2) / bw, (vh - pad * 2) / bh)),
      )
      fitVp = {
        zoom,
        x: (vw - bw * zoom) / 2 - minX * zoom,
        y: (vh - bh * zoom) / 2 - minY * zoom,
      }
    }

    // Parallel: cards fan→free + nested B gather→free + viewport zoom-in
    const t0 = performance.now()
    const dur = 560
    const vp0 = continuousVp
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)

    // Drive layout anim (force: enter already set animating to lock interaction)
    if (ends.length > 0) {
      get().animateToLayout(ends, dur, { skipHistory: true, force: true })
    }

    const tickVp = (now: number) => {
      if (get().currentContainerId !== stackId) return
      const t = Math.min(1, (now - t0) / dur)
      const e = ease(t)

      if (nestedEnterUnits.length > 0) {
        const unitPose = new Map<
          string,
          { x: number; y: number; width: number; height: number }
        >()
        for (const u of nestedEnterUnits) {
          unitPose.set(u.stackId, {
            x: u.start.x + (u.end.x - u.start.x) * e,
            y: u.start.y + (u.end.y - u.start.y) * e,
            width: u.start.width + (u.end.width - u.start.width) * e,
            height: u.start.height + (u.end.height - u.start.height) * e,
          })
        }
        set((st) => ({
          viewport: {
            zoom: vp0.zoom + (fitVp.zoom - vp0.zoom) * e,
            x: vp0.x + (fitVp.x - vp0.x) * e,
            y: vp0.y + (fitVp.y - vp0.y) * e,
          },
          items: st.items.map((item) => {
            if (!nestedLeafIds.has(item.id)) return item
            for (const u of nestedEnterUnits) {
              const r = u.rel.find((x) => x.id === item.id)
              if (!r) continue
              const p = unitPose.get(u.stackId)!
              const direct = containerOf(item) === u.stackId
              return {
                ...item,
                stackPreview: direct
                  ? {
                      x: p.x + r.dx,
                      y: p.y + r.dy,
                      rotation: r.rotation,
                    }
                  : {
                      // Deeper nest stays unit-local (B-local); folder origin carries motion
                      x: r.dx,
                      y: r.dy,
                      rotation: r.rotation,
                    },
              }
            }
            return item
          }),
          stacks: st.stacks.map((rec) => {
            const p = unitPose.get(rec.id)
            if (!p) return rec
            return {
              ...rec,
              x: p.x,
              y: p.y,
              width: p.width,
              height: p.height,
            }
          }),
        }))
      } else {
        set({
          viewport: {
            zoom: vp0.zoom + (fitVp.zoom - vp0.zoom) * e,
            x: vp0.x + (fitVp.x - vp0.x) * e,
            y: vp0.y + (fitVp.y - vp0.y) * e,
          },
        })
      }

      if (t < 1) {
        requestAnimationFrame(tickVp)
        return
      }

      // Snap nested B to exact free pose + cached free fan (no recompute)
      if (nestedEnterUnits.length > 0) {
        set((st) => ({
          items: st.items.map((item) => {
            if (!nestedLeafIds.has(item.id)) return item
            for (const u of nestedEnterUnits) {
              const r = u.rel.find((x) => x.id === item.id)
              if (!r) continue
              const direct = containerOf(item) === u.stackId
              return {
                ...item,
                stackPreview: direct
                  ? {
                      x: u.end.x + r.dx,
                      y: u.end.y + r.dy,
                      rotation: r.rotation,
                    }
                  : {
                      x: r.dx,
                      y: r.dy,
                      rotation: r.rotation,
                    },
              }
            }
            return item
          }),
          stacks: st.stacks.map((rec) => {
            const u = nestedEnterById.get(rec.id)
            if (!u) return rec
            return {
              ...rec,
              x: u.free.x,
              y: u.free.y,
              width: u.free.width,
              height: u.free.height,
              ...(u.freeFanRelToPersist
                ? { freeFanRel: u.freeFanRelToPersist }
                : {}),
            }
          }),
        }))
      }
      // Pose + viewport enter done. Unlock if morph/peer fade already finished.
      if (!get().stackEnterAnim) {
        set({ animating: false })
      }
    }
    requestAnimationFrame(tickVp)
  },

  navigateToContainer: (containerId) => {
    const s = get()
    if (containerId === s.currentContainerId) return
    if (s.animating) return

    const leavingId = s.currentContainerId
    const leavingStack =
      leavingId !== ROOT_CONTAINER_ID
        ? s.stacks.find((st) => st.id === leavingId)
        : null

    // Save viewport on current stack / home
    if (leavingId === ROOT_CONTAINER_ID) {
      set({ homeViewport: { ...s.viewport } })
    } else if (leavingStack) {
      set({
        stacks: s.stacks.map((st) =>
          st.id === leavingId ? withViewport(st, s.viewport) : st,
        ),
      })
    }

    /**
     * Exit = reverse of enter, modeled after Ctrl+G (animateToLayout):
     * - Apply final render mode (stacked origin) from frame 0
     * - Lerp poses to exact fan targets; last frame IS the final pose
     * - Folder morphs fullscreen → fan bbox (enter run backwards)
     * - Handoff keeps the same world numbers (no remapping) → no end jump
     */
    if (
      leavingStack &&
      (containerId === leavingStack.parentId ||
        containerId === ROOT_CONTAINER_ID ||
        s.stacks.some((st) => st.id === containerId))
    ) {
      const members = itemsInContainer(s.items, leavingId)
      // Nested stacks on this canvas are atomic bodies (same as free items for fan)
      const childStacks = stacksInContainer(s.stacks, leavingId)
      if (members.length > 0 || childStacks.length > 0) {
        // Free layout to restore after handoff (next enter)
        const freeMap = new Map(
          members.map((m) => [
            m.id,
            { x: m.x, y: m.y, rotation: m.rotation ?? 0 },
          ]),
        )
        const exitVp0 = { ...get().viewport }

        /*
         * Folder chrome target = the stack's own record size in local space.
         * Local (0,0) is the folder top-left (enter continuous viewport).
         */
        const folderLocal = {
          x: 0,
          y: 0,
          width: leavingStack.width,
          height: leavingStack.height,
        }
        const newX = folderLocal.x
        const newY = folderLocal.y
        const newW = folderLocal.width
        const newH = folderLocal.height

        /*
         * Fan bodies on A:
         * - free items of A
         * - each nested stack B as ONE unit = compact fan of B's members (A-local)
         *   Folder always = bounds of that fan (never free-layout world poses).
         */
        type NestedUnit = {
          stackId: string
          /** A-local fan poses for B's direct members (relative offsets from unit origin) */
          rel: Array<{
            id: string
            dx: number
            dy: number
            rotation: number
            width: number
            height: number
            zIndex: number
          }>
          start: { x: number; y: number; width: number; height: number }
        }
        // Preserve free pose of nested stacks on A (restored on handoff; never
        // re-expanded by fan recompute — that grew B's frame on each exit).
        const nestedFreePose = new Map(
          childStacks.map((cs) => [
            cs.id,
            {
              x: cs.x,
              y: cs.y,
              width: cs.width,
              height: cs.height,
            },
          ]),
        )
        /** freeFanRel to write back if missing (capture free layout before gather) */
        const nestedFreeFanRelPersist = new Map<
          string,
          Array<{ id: string; dx: number; dy: number; rotation: number }>
        >()
        const nestedUnits: NestedUnit[] = []
        for (const cs of childStacks) {
          const freeShell = nestedFreePose.get(cs.id)!
          // Free layout while inside A — include deep leaves (C under B)
          const resolved = resolveNestedFreeFan(cs, s.items, {
            preferPreview: true,
            stacks: s.stacks,
          })
          if (resolved.needsPersist) {
            nestedFreeFanRelPersist.set(
              cs.id,
              resolved.rel.map((r) => ({ ...r })),
            )
          }
          const itemById = new Map(s.items.map((m) => [m.id, m]))

          // Start = free shell (current B place on A)
          const start = { ...freeShell }
          nestedUnits.push({
            stackId: cs.id,
            start,
            // Rigid free fan (all leaves) — never recompute compact fan on parent exit
            rel: resolved.rel.map((r) => {
              const m = itemById.get(r.id)
              return {
                id: r.id,
                dx: r.dx,
                dy: r.dy,
                rotation: r.rotation,
                width: m?.width ?? 100,
                height: m?.height ?? 80,
                zIndex: m?.zIndex ?? 0,
              }
            }),
          })
        }

        const itemBodies = members.map((m) => ({
          id: m.id,
          x: m.x,
          y: m.y,
          width: m.width,
          height: m.height,
          zIndex: m.zIndex,
        }))
        // Unit z = visual top of nested fan (max leaf z), not folder slot alone —
        // so B stays above free siblings when its cards were on top.
        const stackBodies = nestedUnits.map((u) => {
          const cs = childStacks.find((c) => c.id === u.stackId)
          return {
            id: u.stackId,
            x: u.start.x,
            y: u.start.y,
            width: u.start.width,
            height: u.start.height,
            zIndex: cs
              ? nestedStackUnitMaxZ(cs, s.items, s.stacks)
              : 0,
          }
        })
        const mixedFan = computeQuickStackBodies([
          ...itemBodies,
          ...stackBodies,
        ])
        const childStackIdSet = new Set(childStacks.map((st) => st.id))
        const nestedUnitById = new Map(
          nestedUnits.map((u) => [u.stackId, u]),
        )

        /*
         * Build A-local end poses, then pin the FULL leaf set (free + nested B
         * cards) with rotation-aware folder pad so chrome never clips content.
         * Prefer existing stackPreview for free items (enter reverse) but always
         * re-pin after — previews alone can sit at origin and eat left/top pad.
         */
        type Pose2 = { x: number; y: number; rotation: number }
        /*
         * When nested stack units are present, ALWAYS use the mixed fan for free
         * items + units together. Preferring free-item-only stackPreview would
         * place free cards in one formation and B in another → gather misalignment.
         * Preview reverse only when the pile is free items alone.
         */
        let freeFanRaw = new Map<string, Pose2>(
          mixedFan
            .filter((t) => !childStackIdSet.has(t.id))
            .map((t) => [
              t.id,
              {
                x: t.x,
                y: t.y,
                rotation: t.rotation ?? 0,
              },
            ]),
        )
        if (nestedUnits.length === 0) {
          const fanFromPreview = members.map((m) => {
            const sp = m.stackPreview
            if (sp) {
              return {
                id: m.id,
                x: sp.x - leavingStack.x,
                y: sp.y - leavingStack.y,
                rotation: sp.rotation ?? 0,
              }
            }
            return null
          })
          if (
            members.length > 0 &&
            fanFromPreview.every((t) => t != null)
          ) {
            freeFanRaw = new Map(
              fanFromPreview.map((t) => [
                t!.id,
                { x: t!.x, y: t!.y, rotation: t!.rotation },
              ]),
            )
          }
        }

        const nestedUnitStartById = new Map(
          nestedUnits.map((u) => [u.stackId, u.start]),
        )
        const unitFanRaw = new Map(
          mixedFan
            .filter((t) => childStackIdSet.has(t.id))
            .map((t) => {
              const start = nestedUnitStartById.get(t.id)
              return [
                t.id,
                {
                  x: t.x,
                  y: t.y,
                  // Keep unit size stable (rigid fan) through gather
                  width: start?.width ?? t.width ?? 120,
                  height: start?.height ?? t.height ?? 80,
                },
              ] as const
            }),
        )

        // All leaf cards (for pin bounds) — must include nested B members
        const pinLeafItems: CanvasItem[] = []
        for (const m of members) {
          const p = freeFanRaw.get(m.id)
          if (!p) continue
          pinLeafItems.push({
            ...m,
            x: p.x,
            y: p.y,
            rotation: p.rotation,
          } as CanvasItem)
        }
        for (const [sid, uPose] of unitFanRaw) {
          const nu = nestedUnitById.get(sid)
          if (!nu) continue
          for (const rel of nu.rel) {
            const src = s.items.find((i) => i.id === rel.id)
            pinLeafItems.push({
              ...(src ??
                ({
                  id: rel.id,
                  type: 'textcard',
                  width: rel.width,
                  height: rel.height,
                  zIndex: rel.zIndex,
                } as CanvasItem)),
              x: uPose.x + rel.dx,
              y: uPose.y + rel.dy,
              width: rel.width,
              height: rel.height,
              rotation: rel.rotation,
            } as CanvasItem)
          }
        }
        const pinHull =
          stackGroupBounds(pinLeafItems) ??
          folderBoundsFromFan(
            pinLeafItems.map((c) => ({
              x: c.x,
              y: c.y,
              width: c.width,
              height: c.height,
            })),
          )
        const pinDx = pinHull ? newX - pinHull.x : 0
        const pinDy = pinHull ? newY - pinHull.y : 0

        const fanMap = new Map(
          [...freeFanRaw.entries()].map(([id, p]) => [
            id,
            {
              x: p.x + pinDx,
              y: p.y + pinDy,
              rotation: p.rotation,
            },
          ]),
        )
        /** Nested unit end pose (A-local top-left of unit bounds) */
        const stackFanMap = new Map(
          [...unitFanRaw.entries()].map(([id, u]) => [
            id,
            {
              x: u.x + pinDx,
              y: u.y + pinDy,
              width: u.width,
              height: u.height,
            },
          ]),
        )

        // Final chrome size = padded hull of ALL leaves after pin (origin 0,0)
        const finalLeafItems: CanvasItem[] = pinLeafItems.map(
          (c) =>
            ({
              ...c,
              x: c.x + pinDx,
              y: c.y + pinDy,
            }) as CanvasItem,
        )
        const finalHull =
          stackGroupBounds(finalLeafItems) ?? {
            x: 0,
            y: 0,
            width: newW,
            height: newH,
          }
        // Origin is folder top-left; after pin hull should sit at ~0
        const finalAW = Math.max(
          1,
          finalHull.x + finalHull.width,
          ...finalLeafItems.map((c) => c.x + c.width + STACK_FOLDER_PAD),
        )
        const finalAH = Math.max(
          1,
          finalHull.y + finalHull.height,
          ...finalLeafItems.map((c) => c.y + c.height + STACK_FOLDER_PAD),
        )

        const stackStartMap = new Map(
          nestedUnits.map((u) => [
            u.stackId,
            {
              x: u.start.x,
              y: u.start.y,
              width: u.start.width,
              height: u.start.height,
            },
          ]),
        )

        // Parent-world pose of the leaving stack record
        const parentStackX = leavingStack.x
        const parentStackY = leavingStack.y

        const vw =
          typeof window !== 'undefined' ? window.innerWidth : 1440
        const vh =
          typeof window !== 'undefined' ? window.innerHeight : 900
        const z = exitVp0.zoom
        // Morph / viewport target use FINAL folder size (not stale pre-exit size)
        const centerLocalVp = {
          zoom: z,
          x: vw / 2 - (finalAW / 2) * z,
          y: vh / 2 - (finalAH / 2) * z,
        }
        const continuousVp = {
          zoom: z,
          x: centerLocalVp.x - parentStackX * z,
          y: centerLocalVp.y - parentStackY * z,
        }

        const fullScreen = { x: 0, y: 0, w: vw, h: vh }
        const folderScreen = {
          x: centerLocalVp.x,
          y: centerLocalVp.y,
          w: finalAW * z,
          h: finalAH * z,
        }

        const memberIds = new Set(members.map((m) => m.id))
        const stackName = (leavingStack.name || '').trim()

        const startMap = new Map(
          members.map((m) => [
            m.id,
            { x: m.x, y: m.y, rotation: m.rotation ?? 0 },
          ]),
        )

        const t0 = performance.now()
        /** Parent peers: start ~200ms after exit begins, ease over ~500ms */
        const peerRevealAt = (now: number) => {
          const u = Math.max(0, Math.min(1, (now - t0 - 200) / 500))
          return u * u * (3 - 2 * u)
        }

        // Nested leaf id → unit for frame-0 seating
        const nestedRelByLeaf = new Map<
          string,
          { unitId: string; dx: number; dy: number; rotation: number }
        >()
        for (const u of nestedUnits) {
          for (const r of u.rel) {
            nestedRelByLeaf.set(r.id, {
              unitId: u.stackId,
              dx: r.dx,
              dy: r.dy,
              rotation: r.rotation,
            })
          }
        }

        set({
          animating: true,
          selectedIds: [],
          selectedStackIds: [],
          editingId: null,
          editingStackGroupId: null,
          viewport: exitVp0,
          items: get().items.map((item) => {
            if (memberIds.has(item.id)) {
              return {
                ...item,
                stacked: true,
                stackGroupId: leavingId,
              } as CanvasItem
            }
            // Seat nested B leaves under unit start (rigid fan) — no first-frame pop
            const nr = nestedRelByLeaf.get(item.id)
            if (nr) {
              const st = stackStartMap.get(nr.unitId)
              if (st) {
                return {
                  ...item,
                  stackPreview: {
                    x: st.x + nr.dx,
                    y: st.y + nr.dy,
                    rotation: nr.rotation,
                  },
                } as CanvasItem
              }
            }
            return item
          }),
          stacks: get().stacks.map((rec) => {
            const st = stackStartMap.get(rec.id)
            if (!st) return rec
            return {
              ...rec,
              x: st.x,
              y: st.y,
              width: st.width,
              height: st.height,
            }
          }),
          stackEnterAnim: {
            stackId: leavingId,
            mode: 'exit',
            start: fullScreen,
            end: folderScreen,
            t: 0,
            settle: 0,
            peerReveal: 0,
            nestedChromeOpacity: 1,
            name: stackName,
            memberCount: countLeafItemsInStack(
              get().items,
              get().stacks,
              leavingId,
            ),
            // Path switches immediately with exit; canvas handoff stays at end
            targetContainerId: containerId,
          },
        })

        const leafCountExit = countLeafItemsInStack(
          get().items,
          get().stacks,
          leavingId,
        )
        const dur = 560
        const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
        const folderPhase = (t: number) => easeOut(t)
        // Nested folder chrome dissolves during gather (slightly leads the end)
        const nestedChromeAt = (eFolder: number) =>
          Math.max(0, 1 - Math.min(1, eFolder / 0.85))

        const tick = (now: number) => {
          if (get().currentContainerId !== leavingId) {
            set({ animating: false, stackEnterAnim: null })
            return
          }
          const raw = Math.min(1, (now - t0) / dur)
          const e = easeOut(raw)
          const eFolder = folderPhase(raw)
          const peerReveal = peerRevealAt(now)
          const nestedChromeOpacity = nestedChromeAt(eFolder)

          // Nested unit current top-left (A-local) for this frame
          const unitPose = new Map<
            string,
            { x: number; y: number; width: number; height: number }
          >()
          for (const [sid, a] of stackStartMap) {
            const b = stackFanMap.get(sid)
            if (!b) continue
            unitPose.set(sid, {
              x: a.x + (b.x - a.x) * e,
              y: a.y + (b.y - a.y) * e,
              width: a.width + (b.width - a.width) * e,
              height: a.height + (b.height - a.height) * e,
            })
          }

          set((st) => ({
            items: st.items.map((item) => {
              if (memberIds.has(item.id)) {
                const a = startMap.get(item.id)
                const b = fanMap.get(item.id)
                if (!a || !b) return item
                return {
                  ...item,
                  stacked: true,
                  stackGroupId: leavingId,
                  x: a.x + (b.x - a.x) * e,
                  y: a.y + (b.y - a.y) * e,
                  rotation:
                    (a.rotation ?? 0) +
                    ((b.rotation ?? 0) - (a.rotation ?? 0)) * e,
                } as CanvasItem
              }
              // Nested unit leaves: direct B → parent-abs; deeper C → B-local
              // (folder origin unit.x/y carries C while B gathers)
              for (const [sid, unit] of unitPose) {
                const nu = nestedUnitById.get(sid)
                if (!nu) continue
                const rel = nu.rel.find((r) => r.id === item.id)
                if (!rel) continue
                const direct = containerOf(item) === sid
                return {
                  ...item,
                  stackPreview: direct
                    ? {
                        x: unit.x + rel.dx,
                        y: unit.y + rel.dy,
                        rotation: rel.rotation,
                      }
                    : {
                        x: rel.dx,
                        y: rel.dy,
                        rotation: rel.rotation,
                      },
                } as CanvasItem
              }
              return item
            }),
            // Nested stacks: folder = unit bounds (always under fan)
            stacks: st.stacks.map((rec) => {
              const u = unitPose.get(rec.id)
              if (!u) return rec
              return {
                ...rec,
                x: u.x,
                y: u.y,
                width: u.width,
                height: u.height,
              }
            }),
            viewport: {
              zoom: z,
              x: exitVp0.x + (centerLocalVp.x - exitVp0.x) * e,
              y: exitVp0.y + (centerLocalVp.y - exitVp0.y) * e,
            },
            stackEnterAnim: {
              stackId: leavingId,
              mode: 'exit',
              start: fullScreen,
              end: folderScreen,
              t: eFolder,
              settle: 0,
              peerReveal,
              nestedChromeOpacity,
              name: stackName,
              memberCount: leafCountExit,
              targetContainerId: containerId,
            },
          }))

          if (raw < 1) {
            requestAnimationFrame(tick)
            return
          }

          const peerAtHandoff = peerRevealAt(performance.now())
          // Final poses: nested member stackPreview stays A-local (parent of B = A).
          // Direct A members get parent-of-A absolute stackPreview.
          // Nested StackRecord free pose on A is restored so re-enter keeps place;
          // home fan uses leaf stackPreview (not B.x/y) when previews exist.
          // Freeze surface z to exit fan order (back→front).
          const liveForZ = get()
          const surfaceBackToFront = mixedFan.map((t) =>
            childStackIdSet.has(t.id)
              ? ({ kind: 'stack' as const, id: t.id })
              : ({ kind: 'item' as const, id: t.id }),
          )
          const frozenZ = freezeStackSurfaceZ(
            liveForZ.items,
            liveForZ.stacks,
            leavingId,
            surfaceBackToFront,
            leavingStack.zIndex,
          )
          set({
            animating: true,
            nextZ: Math.max(liveForZ.nextZ, frozenZ.nextZ),
            items: get().items.map((item) => {
              const z = frozenZ.itemZMap.get(item.id)
              if (memberIds.has(item.id)) {
                const free = freeMap.get(item.id)
                const f = fanMap.get(item.id)
                if (!f) {
                  return z != null ? { ...item, zIndex: z } : item
                }
                return {
                  ...item,
                  stacked: false,
                  stackGroupId: undefined,
                  x: free?.x ?? item.x,
                  y: free?.y ?? item.y,
                  rotation: free?.rotation ?? 0,
                  zIndex: z ?? item.zIndex,
                  stackPreview: {
                    x: parentStackX + f.x,
                    y: parentStackY + f.y,
                    rotation: f.rotation ?? 0,
                  },
                } as CanvasItem
              }
              // Nested unit leaves: keep B-local offsets for deep (C); direct B
              // get A-local gather. Home pile places C via freeFanRel + visual origin.
              for (const [sid, endU] of stackFanMap) {
                const nu = nestedUnitById.get(sid)
                if (!nu) continue
                const rel = nu.rel.find((r) => r.id === item.id)
                if (!rel) continue
                const direct = containerOf(item) === sid
                return {
                  ...item,
                  zIndex: z ?? item.zIndex,
                  stackPreview: direct
                    ? {
                        x: endU.x + rel.dx,
                        y: endU.y + rel.dy,
                        rotation: rel.rotation,
                      }
                    : {
                        x: rel.dx,
                        y: rel.dy,
                        rotation: rel.rotation,
                      },
                } as CanvasItem
              }
              return z != null ? { ...item, zIndex: z } : item
            }),
            stacks: get().stacks.map((st) => {
              const sz = frozenZ.stackZMap.get(st.id)
              if (st.id === leavingId) {
                // Cache collapsed fan of THIS stack (folder-local), including deep
                // leaves (A⊃B⊃C). Must use GATHER end poses for nested units —
                // freePose+rel left C at free layout far from the pile while
                // direct free members used fanMap gather, so C sat bottom-right.
                const freeFanRel = freeFanRelFromLocalFan(
                  members
                    .map((m) => {
                      const f = fanMap.get(m.id)
                      if (!f) return null
                      return {
                        id: m.id,
                        x: f.x,
                        y: f.y,
                        rotation: f.rotation,
                      }
                    })
                    .filter(
                      (
                        c,
                      ): c is {
                        id: string
                        x: number
                        y: number
                        rotation: number
                      } => c != null,
                    ),
                )
                // Nested child trees: same gather-local space as direct free fan
                for (const nu of nestedUnits) {
                  const endU = stackFanMap.get(nu.stackId)
                  if (!endU) continue
                  for (const r of nu.rel) {
                    if (freeFanRel.some((x) => x.id === r.id)) continue
                    freeFanRel.push({
                      id: r.id,
                      dx: endU.x + r.dx,
                      dy: endU.y + r.dy,
                      rotation: r.rotation,
                    })
                  }
                }
                return {
                  ...st,
                  x: parentStackX,
                  y: parentStackY,
                  width: finalAW,
                  height: finalAH,
                  viewport: { ...exitVp0 },
                  zIndex: sz ?? st.zIndex,
                  ...(freeFanRel.length > 0 ? { freeFanRel } : {}),
                }
              }
              // Nested B: restore free pose on A (fixed shell; freeFanRel with deep leaves)
              const freePose = nestedFreePose.get(st.id)
              if (freePose) {
                const persistRel = nestedFreeFanRelPersist.get(st.id)
                return {
                  ...st,
                  x: freePose.x,
                  y: freePose.y,
                  width: freePose.width,
                  height: freePose.height,
                  zIndex: sz ?? st.zIndex,
                  ...(persistRel ? { freeFanRel: persistRel } : {}),
                }
              }
              return sz != null ? { ...st, zIndex: sz } : st
            }),
            currentContainerId: containerId,
            selectedIds: [],
            selectedStackIds: [],
            editingId: null,
            editingStackGroupId: null,
            stackEnterAnim: {
              stackId: leavingId,
              mode: 'exit',
              start: fullScreen,
              end: folderScreen,
              t: 1,
              settle: 0,
              peerReveal: peerAtHandoff,
              nestedChromeOpacity: 0,
              name: stackName,
              memberCount: leafCountExit,
              targetContainerId: containerId,
            },
            viewport: continuousVp,
            ...(containerId === ROOT_CONTAINER_ID
              ? { homeViewport: continuousVp }
              : {}),
          })

          const settleT0 = performance.now()
          const settleDur = 160
          const settleTick = (now: number) => {
            const st = Math.min(1, (now - settleT0) / settleDur)
            const e = st * st * (3 - 2 * st)
            const anim = get().stackEnterAnim
            if (!anim || anim.mode !== 'exit') {
              set({ animating: false, stackEnterAnim: null })
              return
            }
            set({
              stackEnterAnim: {
                ...anim,
                t: 1,
                settle: e,
                peerReveal: peerRevealAt(now),
              },
            })
            if (st < 1 || peerRevealAt(now) < 0.999) {
              requestAnimationFrame(settleTick)
            } else {
              set({ animating: false, stackEnterAnim: null })
            }
          }
          requestAnimationFrame(settleTick)
        }
        requestAnimationFrame(tick)
        return
      }
    }

    if (containerId === ROOT_CONTAINER_ID) {
      set({
        currentContainerId: ROOT_CONTAINER_ID,
        selectedIds: [],
        selectedStackIds: [],
        editingId: null,
        editingStackGroupId: null,
        stackEnterAnim: null,
        viewport: { ...get().homeViewport },
      })
      return
    }

    const target = get().stacks.find((st) => st.id === containerId)
    if (!target) return
    get().enterStack(containerId)
  },

  updateStacks: (patches) => {
    const map = new Map(patches.map((p) => [p.id, p.patch]))
    set((s) => {
      // When folder x/y changes, shift child fan previews by the same delta
      // so chrome + cards never desync (drag uses updateStacks with absolute x/y).
      const deltas = new Map<string, { dx: number; dy: number }>()
      const stacks = s.stacks.map((st) => {
        const patch = map.get(st.id)
        if (!patch) return st
        const next = { ...st, ...patch }
        const dx = (patch.x !== undefined ? patch.x : st.x) - st.x
        const dy = (patch.y !== undefined ? patch.y : st.y) - st.y
        if (dx !== 0 || dy !== 0) deltas.set(st.id, { dx, dy })
        return next
      })
      if (deltas.size === 0) {
        return { dirty: true, stacks }
      }
      return {
        dirty: true,
        stacks,
        items: s.items.map((item) => {
          const d = deltas.get(containerOf(item))
          if (!d || !item.stackPreview) return item
          return {
            ...item,
            stackPreview: {
              ...item.stackPreview,
              x: item.stackPreview.x + d.dx,
              y: item.stackPreview.y + d.dy,
            },
          }
        }),
      }
    })
  },

  moveStacks: (ids, dx, dy) => {
    if (dx === 0 && dy === 0) return
    const idSet = new Set(ids)
    set((s) => ({
      dirty: true,
      stacks: s.stacks.map((st) =>
        idSet.has(st.id) ? { ...st, x: st.x + dx, y: st.y + dy } : st,
      ),
      // Fan previews live in parent world space — move with the folder
      items: s.items.map((item) => {
        if (!item.stackPreview) return item
        if (!idSet.has(containerOf(item))) return item
        return {
          ...item,
          stackPreview: {
            ...item.stackPreview,
            x: item.stackPreview.x + dx,
            y: item.stackPreview.y + dy,
          },
        }
      }),
    }))
  },

  pushHistory: () => {
    const { items, stacks, nextZ, currentContainerId, history } = get()
    const entry: HistoryEntry = {
      items: cloneItems(items),
      stacks: cloneStacks(stacks),
      nextZ,
      currentContainerId,
    }
    set({
      history: [...history.slice(-49), entry],
      future: [],
      dirty: true,
    })
  },

  markDirty: () => set({ dirty: true }),
  clearDirty: () => set({ dirty: false }),
  setBoardFilePath: (path) => set({ boardFilePath: path }),
  setBoardName: (name) => set({ boardName: name, dirty: true }),

  undo: () => {
    const { history, items, stacks, nextZ, currentContainerId, future } =
      get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({
      history: history.slice(0, -1),
      future: [
        ...future,
        {
          items: cloneItems(items),
          stacks: cloneStacks(stacks),
          nextZ,
          currentContainerId,
        },
      ],
      items: prev.items,
      stacks: prev.stacks ?? [],
      nextZ: prev.nextZ,
      currentContainerId: prev.currentContainerId ?? ROOT_CONTAINER_ID,
      selectedIds: [],
      selectedStackIds: [],
      dirty: true,
    })
  },

  redo: () => {
    const { future, items, stacks, nextZ, currentContainerId, history } =
      get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    set({
      future: future.slice(0, -1),
      history: [
        ...history,
        {
          items: cloneItems(items),
          stacks: cloneStacks(stacks),
          nextZ,
          currentContainerId,
        },
      ],
      items: next.items,
      stacks: next.stacks ?? [],
      nextZ: next.nextZ,
      currentContainerId: next.currentContainerId ?? ROOT_CONTAINER_ID,
      selectedIds: [],
      selectedStackIds: [],
      dirty: true,
    })
  },

  addItems: (newItems, select = true) => {
    get().pushHistory()
    const containerId = get().currentContainerId
    const tagged = newItems.map((i) => tagContainer(i, containerId))
    set((s) => ({
      dirty: true,
      items: [...s.items, ...tagged],
      nextZ: Math.max(s.nextZ, ...tagged.map((i) => i.zIndex + 1)),
      selectedIds: select ? tagged.map((i) => i.id) : s.selectedIds,
      selectedStackIds: select ? [] : s.selectedStackIds,
    }))
  },

  updateItem: (id, patch) =>
    set((s) => ({
      dirty: true,
      items: s.items.map((item) =>
        item.id === id ? ({ ...item, ...patch } as CanvasItem) : item,
      ),
    })),

  updateItems: (patches) => {
    const map = new Map(patches.map((p) => [p.id, p.patch]))
    set((s) => ({
      dirty: true,
      items: s.items.map((item) => {
        const patch = map.get(item.id)
        return patch ? ({ ...item, ...patch } as CanvasItem) : item
      }),
    }))
  },

  moveItems: (ids, dx, dy) => {
    const idSet = new Set(ids)
    set((s) => ({
      items: s.items.map((item) => {
        if (!idSet.has(item.id) || item.locked) return item
        // Paths are local — only box moves
        return { ...item, x: item.x + dx, y: item.y + dy }
      }),
    }))
  },

  resizeItem: (id, width, height, x, y) =>
    set((s) => ({
      dirty: true,
      items: s.items.map((item) =>
        item.id === id
          ? {
              ...item,
              width: Math.max(24, width),
              height: Math.max(24, height),
              ...(x !== undefined ? { x } : {}),
              ...(y !== undefined ? { y } : {}),
            }
          : item,
      ),
    })),

  deleteSelected: () => {
    const { selectedIds, selectedStackIds, editingStackGroupId, stacks } =
      get()
    if (selectedIds.length === 0 && selectedStackIds.length === 0) return
    get().pushHistory()
    const idSet = new Set(selectedIds)

    // Deleting a stack removes it and all nested content
    let removeStackIds = new Set<string>()
    for (const sid of selectedStackIds) {
      for (const id of collectDescendantStackIds(stacks, sid)) {
        removeStackIds.add(id)
      }
    }
    const removeItemIds = new Set(idSet)
    if (removeStackIds.size > 0) {
      for (const it of get().items) {
        if (removeStackIds.has(containerOf(it))) removeItemIds.add(it.id)
      }
    }

    set((s) => ({
      items: s.items.filter((i) => !removeItemIds.has(i.id)),
      stacks: s.stacks.filter((st) => !removeStackIds.has(st.id)),
      selectedIds: [],
      selectedStackIds: [],
      editingStackGroupId:
        editingStackGroupId && removeStackIds.has(editingStackGroupId)
          ? null
          : s.editingStackGroupId,
      dirty: true,
    }))
  },

  hasClipboard: () =>
    !!(
      canvasClipboard &&
      (canvasClipboard.items.length > 0 || canvasClipboard.stacks.length > 0)
    ),

  copySelection: () => {
    const s = get()
    if (s.animating) return false
    const snap = snapshotSelection(s)
    if (!snap) return false
    canvasClipboard = { ...snap, mode: 'copy' }
    return true
  },

  cutSelection: () => {
    const s = get()
    if (s.animating) return false
    const snap = snapshotSelection(s)
    if (!snap) return false

    // Same removal set as delete, but we already have the snapshot
    const removeStackIds = new Set(snap.stacks.map((st) => st.id))
    const removeItemIds = new Set(snap.items.map((i) => i.id))

    get().pushHistory()
    canvasClipboard = { ...snap, mode: 'cut' }

    const { editingStackGroupId } = get()
    set((st) => ({
      items: st.items.filter((i) => !removeItemIds.has(i.id)),
      stacks: st.stacks.filter((rec) => !removeStackIds.has(rec.id)),
      selectedIds: [],
      selectedStackIds: [],
      editingId: null,
      editingStackGroupId:
        editingStackGroupId && removeStackIds.has(editingStackGroupId)
          ? null
          : st.editingStackGroupId,
      dirty: true,
    }))
    return true
  },

  pasteClipboard: () => {
    const clip = canvasClipboard
    if (!clip || (clip.items.length === 0 && clip.stacks.length === 0)) {
      return false
    }
    const s = get()
    if (s.animating) return false

    get().pushHistory()

    const targetContainer = s.currentContainerId

    // Remap stack ids first
    const stackIdMap = new Map<string, string>()
    for (const st of clip.stacks) {
      stackIdMap.set(st.id, uid('stack'))
    }

    // Top-level stacks = parent is not another stack in this clipboard
    const isTopLevelStack = (st: StackRecord) => !stackIdMap.has(st.parentId)

    // Bounds of free items + top-level stacks for re-centering on paste
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const expand = (x: number, y: number, w: number, h: number) => {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + w)
      maxY = Math.max(maxY, y + h)
    }

    for (const st of clip.stacks) {
      if (isTopLevelStack(st)) expand(st.x, st.y, st.width, st.height)
    }
    for (const it of clip.items) {
      // Nested inside a cut stack → local to that stack, not world bounds
      if (stackIdMap.has(containerOf(it))) continue
      expand(it.x, it.y, it.width, it.height)
    }

    if (!Number.isFinite(minX)) {
      minX = 0
      minY = 0
      maxX = 200
      maxY = 200
    }

    // Place group near viewport center (current canvas world coords)
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900
    const vp = s.viewport
    const centerWorldX = (vw / 2 - vp.x) / vp.zoom
    const centerWorldY = (vh / 2 - vp.y) / vp.zoom
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const dx = centerWorldX - cx
    const dy = centerWorldY - cy

    let z = s.nextZ
    const newStackIds: string[] = []

    const newStacks: StackRecord[] = clip.stacks.map((st) => {
      const newId = stackIdMap.get(st.id)!
      const top = isTopLevelStack(st)
      const parentId = top
        ? targetContainer
        : (stackIdMap.get(st.parentId) ?? targetContainer)
      const next: StackRecord = {
        ...st,
        id: newId,
        parentId,
        x: top ? st.x + dx : st.x,
        y: top ? st.y + dy : st.y,
        zIndex: z++,
        viewport: st.viewport ? { ...st.viewport } : undefined,
      }
      if (top) newStackIds.push(newId)
      return next
    })

    // When pasting a whole stack, shift leaf fan previews that are parent-local
    // for top-level stacks (same dx/dy as the folder)
    const topLevelOldStackIds = new Set(
      clip.stacks.filter(isTopLevelStack).map((st) => st.id),
    )

    const newItems: CanvasItem[] = clip.items.map((raw) => {
      const src = structuredClone(raw) as CanvasItem
      const oldContainer = containerOf(src)
      src.id = uid(src.type)

      if (src.type === 'scribble') {
        src.paths = src.paths.map((p) => ({ ...p, id: uid('path') }))
      }

      // Inside a cut stack tree → stay nested under remapped stack
      if (stackIdMap.has(oldContainer)) {
        const {
          stacked: _s,
          stackGroupId: _g,
          stackName: _n,
          ...rest
        } = src
        let stackPreview = src.stackPreview
          ? { ...src.stackPreview }
          : undefined
        // Direct members of a top-level pasted stack: stackPreview is parent-local
        if (stackPreview && topLevelOldStackIds.has(oldContainer)) {
          stackPreview = {
            ...stackPreview,
            x: stackPreview.x + dx,
            y: stackPreview.y + dy,
          }
        }
        return tagContainer(
          {
            ...(rest as CanvasItem),
            ...(stackPreview ? { stackPreview } : {}),
            zIndex: z++,
          } as CanvasItem,
          stackIdMap.get(oldContainer)!,
        )
      }

      // Free item on source canvas → free on target
      return asPasteFreeItem(
        {
          ...src,
          x: src.x + dx,
          y: src.y + dy,
          zIndex: z++,
        } as CanvasItem,
        targetContainer,
      )
    })

    // Select top-level free items + top-level stacks only
    const topLevelItemIds = newItems
      .filter((i) => containerOf(i) === targetContainer)
      .map((i) => i.id)

    set((st) => ({
      items: [...st.items, ...newItems],
      stacks: [...st.stacks, ...newStacks],
      nextZ: z,
      selectedIds: topLevelItemIds,
      selectedStackIds: newStackIds,
      editingId: null,
      editingStackGroupId: null,
      dirty: true,
    }))

    // After paste, keep payload as copy for multi-paste
    canvasClipboard = { ...clip, mode: 'copy' }

    return true
  },

  bringToFront: (ids) => {
    const s0 = get()
    const target = ids ?? s0.selectedIds
    // When raising the current selection, include selected nested stacks
    const stackIds = ids != null ? [] : s0.selectedStackIds
    if (target.length === 0 && stackIds.length === 0) return
    get().pushHistory()
    set((s) => {
      const { itemZMap, stackZMap, nextZ } = raiseSelectionZ(
        s.items,
        s.stacks,
        target,
        stackIds,
        s.nextZ,
      )
      return {
        nextZ,
        stacks: s.stacks.map((st) =>
          stackZMap.has(st.id) ? { ...st, zIndex: stackZMap.get(st.id)! } : st,
        ),
        items: s.items.map((item) =>
          itemZMap.has(item.id)
            ? { ...item, zIndex: itemZMap.get(item.id)! }
            : item,
        ),
      }
    })
  },

  sendToBack: (ids) => {
    const s0 = get()
    const target = ids ?? s0.selectedIds
    const stackIds = ids != null ? [] : s0.selectedStackIds
    if (target.length === 0 && stackIds.length === 0) return
    get().pushHistory()
    set((s) => {
      // Place whole selection under everything, preserving relative order
      const allItemZs = s.items.map((i) => i.zIndex)
      const allStackZs = s.stacks.map((st) => st.zIndex)
      const floor = Math.min(...allItemZs, ...allStackZs, 1)

      const { itemZMap, stackZMap } = raiseSelectionZ(
        s.items,
        s.stacks,
        target,
        stackIds,
        // Temporary high base then shift — easier: allocate from a low base
        0,
      )
      // Remap allocated 0..n onto values just below current floor
      const maxAllocated = Math.max(
        0,
        ...itemZMap.values(),
        ...stackZMap.values(),
      )
      const shift = floor - maxAllocated - 1
      const shiftMap = (m: Map<string, number>) => {
        const out = new Map<string, number>()
        for (const [k, v] of m) out.set(k, v + shift)
        return out
      }
      const iMap = shiftMap(itemZMap)
      const sMap = shiftMap(stackZMap)

      return {
        stacks: s.stacks.map((st) =>
          sMap.has(st.id) ? { ...st, zIndex: sMap.get(st.id)! } : st,
        ),
        items: s.items.map((item) =>
          iMap.has(item.id) ? { ...item, zIndex: iMap.get(item.id)! } : item,
        ),
      }
    })
  },

  duplicateItems: (ids) => {
    if (ids.length === 0) return []
    const { items, nextZ } = get()
    const idSet = new Set(ids)
    // Preserve relative z order of sources
    const sources = items.filter((i) => idSet.has(i.id)).sort((a, b) => a.zIndex - b.zIndex)
    let z = nextZ
    const newIds: string[] = []
    // Remap stack groups so duplicated stacks stay grouped together
    const groupMap = new Map<string, string>()
    const clones: CanvasItem[] = sources.map((src) => {
      const clone = structuredClone(src) as CanvasItem
      const newId = uid(src.type)
      clone.id = newId
      clone.zIndex = z++
      if (clone.stackGroupId) {
        if (!groupMap.has(clone.stackGroupId)) {
          groupMap.set(clone.stackGroupId, uid('stack'))
        }
        clone.stackGroupId = groupMap.get(clone.stackGroupId)
      }
      if (clone.type === 'scribble') {
        clone.paths = clone.paths.map((p) => ({ ...p, id: uid('path') }))
      }
      newIds.push(newId)
      return clone
    })
    set((s) => ({
      items: [...s.items, ...clones],
      nextZ: z,
      selectedIds: newIds,
      editingId: null,
    }))
    return newIds
  },

  addText: (world, options) => {
    get().pushHistory()
    const z = get().nextZ
    const containerId = get().currentContainerId
    const item: TextItem = tagContainer(
      {
        id: uid('text'),
        type: 'text',
        x: world.x,
        y: world.y,
        width: Math.max(48, options?.width ?? 240),
        height: Math.max(28, options?.height ?? 48),
        rotation: 0,
        zIndex: z,
        content: options?.content ?? '',
        fontSize: 28,
        fontFamily: FONT_STACKS[0].value,
        fontWeight: 500,
        color: '#1e1e1e',
        backgroundColor: 'transparent',
      },
      containerId,
    )
    set((s) => ({
      items: [...s.items, item],
      nextZ: z + 1,
      selectedIds: [item.id],
      selectedStackIds: [],
      tool: 'select',
      editingId: options?.content ? null : item.id,
    }))
  },

  addTextCard: (world, options) => {
    get().pushHistory()
    const z = get().nextZ
    // Always coerce to string — empty only when truly absent
    const content =
      options && typeof options.content === 'string' ? options.content : ''
    // Default width fixed; height wraps to content when pasting text
    const width = options?.width ?? 240
    let height = options?.height ?? 180
    if (content.length > 0 && options?.height == null) {
      height = measureNoteCardHeight(content, width, 14)
    }
    const containerId = get().currentContainerId
    const item: TextCardItem = tagContainer(
      {
        id: uid('textcard'),
        type: 'textcard',
        x: world.x,
        y: world.y,
        width: Math.max(120, width),
        height: Math.max(80, height),
        rotation: 0,
        zIndex: z,
        content,
        fontSize: 14,
        color: '#6b6b6b',
        backgroundColor: '#ffffff',
        labelColor: '#8c8c8c',
        labelBackground: 'transparent',
      },
      containerId,
    )
    set((s) => ({
      items: [...s.items, item],
      nextZ: z + 1,
      selectedIds: [item.id],
      selectedStackIds: [],
      tool: 'select',
      // Only auto-edit brand-new empty notes (not pasted content)
      editingId: content.length > 0 ? null : item.id,
    }))
  },

  convertTextKind: (to, ids) => {
    const targetIds = new Set(ids ?? get().selectedIds)
    if (targetIds.size === 0) return
    const { items } = get()
    let changed = false
    const nextItems = items.map((item) => {
      if (!targetIds.has(item.id) || item.stacked) return item
      if (to === 'text' && item.type === 'textcard') {
        changed = true
        const next: TextItem = {
          id: item.id,
          type: 'text',
          x: item.x,
          y: item.y,
          width: item.width,
          height: Math.max(36, Math.min(item.height, 160)),
          rotation: item.rotation ?? 0,
          zIndex: item.zIndex,
          content: item.content ?? '',
          fontSize: Math.max(14, item.fontSize || 14),
          fontFamily: FONT_STACKS[0].value,
          fontWeight: 500,
          color: item.color || '#1e1e1e',
          backgroundColor: 'transparent',
          locked: item.locked,
        }
        return next
      }
      if (to === 'textcard' && item.type === 'text') {
        changed = true
        const next: TextCardItem = {
          id: item.id,
          type: 'textcard',
          x: item.x,
          y: item.y,
          width: Math.max(160, item.width),
          height: Math.max(100, item.height),
          rotation: item.rotation ?? 0,
          zIndex: item.zIndex,
          content: item.content ?? '',
          fontSize: Math.min(18, Math.max(12, item.fontSize || 14)),
          color: item.color || '#6b6b6b',
          backgroundColor: '#ffffff',
          labelColor: '#8c8c8c',
          labelBackground: 'transparent',
          locked: item.locked,
        }
        return next
      }
      return item
    })
    if (!changed) return
    get().pushHistory()
    set({ items: nextItems, editingId: null })
  },

  alignSelected: (mode: AlignMode) => {
    const s = get()
    const ids = [...s.selectedIds]
    if (ids.length + s.selectedStackIds.length < 2) return
    const { itemPatches, stackPatches } = computeAlignPatches(
      ids,
      s.items,
      mode,
      {
        stacks: s.stacks,
        selectedStackIds: s.selectedStackIds,
        containerId: s.currentContainerId,
      },
    )
    if (!itemPatches.length && !stackPatches.length) return
    get().pushHistory()
    const map = new Map<string, { dx: number; dy: number }>()
    for (const p of itemPatches) {
      const cur = map.get(p.id) || { dx: 0, dy: 0 }
      map.set(p.id, { dx: cur.dx + p.dx, dy: cur.dy + p.dy })
    }
    const live = get().items
    set({
      items: live.map((item) => {
        const d = map.get(item.id)
        if (!d || (d.dx === 0 && d.dy === 0)) return item
        return { ...item, x: item.x + d.dx, y: item.y + d.dy }
      }),
    })
    for (const sp of stackPatches) {
      get().moveStacks([sp.id], sp.dx, sp.dy)
    }
  },

  packSelected: (dir: PackDir) => {
    const s = get()
    const ids = [...s.selectedIds]
    if (ids.length + s.selectedStackIds.length < 2) return
    const { itemPatches, stackPatches } = computePackPatches(
      ids,
      s.items,
      dir,
      {
        stacks: s.stacks,
        selectedStackIds: s.selectedStackIds,
        containerId: s.currentContainerId,
      },
    )
    if (!itemPatches.length && !stackPatches.length) return
    get().pushHistory()
    const map = new Map<string, { dx: number; dy: number }>()
    for (const p of itemPatches) {
      const cur = map.get(p.id) || { dx: 0, dy: 0 }
      map.set(p.id, { dx: cur.dx + p.dx, dy: cur.dy + p.dy })
    }
    const live = get().items
    set({
      items: live.map((item) => {
        const d = map.get(item.id)
        if (!d || (d.dx === 0 && d.dy === 0)) return item
        return { ...item, x: item.x + d.dx, y: item.y + d.dy }
      }),
    })
    for (const sp of stackPatches) {
      get().moveStacks([sp.id], sp.dx, sp.dy)
    }
  },

  addEmbed: (world, data) => {
    get().pushHistory()
    const z = get().nextZ
    const containerId = get().currentContainerId
    const item: EmbedItem = tagContainer(
      {
        id: uid('embed'),
        type: 'embed',
        x: world.x,
        y: world.y,
        width: Math.max(200, data.width),
        height: Math.max(80, data.height),
        rotation: 0,
        zIndex: z,
        html: data.html,
        src: data.src,
        title: data.title,
      },
      containerId,
    )
    set((s) => ({
      items: [...s.items, item],
      nextZ: z + 1,
      selectedIds: [item.id],
      selectedStackIds: [],
      tool: 'select',
      editingId: null,
    }))
  },

  addLinkCard: (world, url = '') => {
    get().pushHistory()
    const z = get().nextZ
    const normalized = url ? normalizeUrl(url) : ''
    const containerId = get().currentContainerId
    // Notion-style bookmark: width ~1.4× original 340, fixed height 160
    const item: LinkCardItem = tagContainer(
      {
        id: uid('link'),
        type: 'link',
        x: world.x,
        y: world.y,
        width: 476,
        height: 160,
        rotation: 0,
        zIndex: z,
        url: normalized,
        title: normalized ? guessTitleFromUrl(normalized) : 'Untitled link',
        description: normalized ? extractHost(normalized) : 'Add a URL',
        favicon: normalized ? faviconFor(normalized) : undefined,
        previewStatus: normalized ? 'pending' : undefined,
      },
      containerId,
    )
    set((s) => ({
      items: [...s.items, item],
      nextZ: z + 1,
      selectedIds: [item.id],
      selectedStackIds: [],
      tool: 'select',
    }))
  },

  startScribble: (world) => {
    get().pushHistory()
    const z = get().nextZ
    const pad = Math.max(get().scribbleWidth, 8)
    const containerId = get().currentContainerId
    // Local coords: first point at (pad, pad)
    const path: ScribblePath = {
      id: uid('path'),
      points: [{ x: pad, y: pad }],
      color: get().scribbleColor,
      width: get().scribbleWidth,
    }
    const item: ScribbleItem = tagContainer(
      {
        id: uid('scribble'),
        type: 'scribble',
        x: world.x - pad,
        y: world.y - pad,
        width: pad * 2,
        height: pad * 2,
        rotation: 0,
        zIndex: z,
        paths: [path],
        strokeColor: get().scribbleColor,
        strokeWidth: get().scribbleWidth,
      },
      containerId,
    )
    set((s) => ({
      items: [...s.items, item],
      nextZ: z + 1,
      activeScribbleId: item.id,
      selectedIds: [item.id],
      selectedStackIds: [],
    }))
    return item.id
  },

  appendScribblePoint: (id, world) => {
    set((s) => ({
      items: s.items.map((item) => {
        if (item.id !== id || item.type !== 'scribble') return item

        // Convert world → current local, then re-normalize bounds
        const local = { x: world.x - item.x, y: world.y - item.y }
        const paths = item.paths.map((p, i) => {
          if (i !== item.paths.length - 1) return p
          return { ...p, points: [...p.points, local] }
        })

        // Convert all points to world, recompute bounds into local
        const worldPaths = paths.map((p) => ({
          ...p,
          points: p.points.map((pt) => ({
            x: pt.x + item.x,
            y: pt.y + item.y,
          })),
        }))
        const pad = Math.max(item.strokeWidth, 8)
        const bounds = recomputeScribbleBounds(worldPaths, pad)
        if (!bounds) return item

        return {
          ...item,
          paths: bounds.paths,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      }),
    }))
  },

  endScribble: () => set({ activeScribbleId: null }),

  eraseAt: (world, radius) => {
    const r = radius ?? get().eraseWidth
    set((s) => ({
      items: s.items
        .map((item) => {
          if (item.type !== 'scribble') return item
          // Only erase if near the scribble bbox (expanded by radius)
          if (
            world.x < item.x - r ||
            world.y < item.y - r ||
            world.x > item.x + item.width + r ||
            world.y > item.y + item.height + r
          ) {
            return item
          }

          const local = { x: world.x - item.x, y: world.y - item.y }
          const nextPaths = eraseFromPaths(item.paths, local, r)
          if (nextPaths.length === 0) return null

          // Recompute in world space
          const worldPaths = nextPaths.map((p) => ({
            ...p,
            points: p.points.map((pt) => ({
              x: pt.x + item.x,
              y: pt.y + item.y,
            })),
          }))
          const pad = Math.max(item.strokeWidth, 8)
          const bounds = recomputeScribbleBounds(worldPaths, pad)
          if (!bounds) return null

          return {
            ...item,
            paths: bounds.paths,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          } as ScribbleItem
        })
        .filter(Boolean) as CanvasItem[],
      selectedIds: s.selectedIds.filter((id) =>
        s.items.some((i) => {
          // drop selection of fully erased items
          if (i.id !== id) return true
          // will be filtered after map - check if still present
          return true
        }),
      ),
    }))
    // Clean selection of removed items
    set((s) => ({
      selectedIds: s.selectedIds.filter((id) => s.items.some((i) => i.id === id)),
    }))
  },

  applyCrop: (id, worldRect) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || (item.type !== 'image' && item.type !== 'gif' && item.type !== 'video')) return
    const result = applyWorldCrop(item, worldRect)
    if (!result) return
    get().pushHistory()
    get().updateItem(id, {
      crop: result.crop as CropRect,
      width: result.width,
      height: result.height,
      x: result.x,
      y: result.y,
    })
  },

  restoreCrop: (ids) => {
    const targetIds = ids ?? get().selectedIds
    const media = get().items.filter(
      (i) =>
        targetIds.includes(i.id) &&
        (i.type === 'image' || i.type === 'gif' || i.type === 'video') &&
        i.crop &&
        (i.crop.w < 0.999 || i.crop.h < 0.999 || i.crop.x > 0.001 || i.crop.y > 0.001),
    )
    if (media.length === 0) return
    get().pushHistory()
    set((s) => ({
      items: s.items.map((item) => {
        if (
          item.type !== 'image' &&
          item.type !== 'gif' &&
          item.type !== 'video'
        ) {
          return item
        }
        if (!targetIds.includes(item.id) || !item.crop) return item
        const crop = item.crop
        const fullW = item.width / Math.max(0.001, crop.w)
        const fullH = item.height / Math.max(0.001, crop.h)
        return {
          ...item,
          x: item.x - crop.x * fullW,
          y: item.y - crop.y * fullH,
          width: fullW,
          height: fullH,
          crop: undefined,
        }
      }),
    }))
  },

  animateToLayout: (targets, durationMs = 520, options) => {
    if (targets.length === 0) return
    const state = get()
    if (state.animating && !options?.force) return
    if (!options?.skipHistory) state.pushHistory()

    const startMap = new Map(
      state.items.map((i) => [i.id, { x: i.x, y: i.y, rotation: i.rotation ?? 0 }]),
    )
    const targetMap = new Map(targets.map((t) => [t.id, t]))
    const targetIds = new Set(targets.map((t) => t.id))

    // Apply stack membership immediately so group-move works mid-animation.
    // When stacking, lock z-order to match pre-stack order (low → bottom, high → top)
    // and reserve one z under the block for folder chrome.
    if (options?.stackGroupId || options?.unstack) {
      const orderedStack = state.items
        .filter((i) => targetIds.has(i.id))
        .sort((a, b) => a.zIndex - b.zIndex)
      const existingName =
        options?.stackGroupId
          ? state.items.find(
              (i) =>
                i.stacked &&
                i.stackGroupId === options.stackGroupId &&
                (i.stackName || '').trim(),
            )?.stackName
          : undefined
      const stackZ = options?.stackGroupId
        ? allocateStackZBlock(
            orderedStack.map((i) => i.id),
            state.nextZ,
          )
        : null

      set((s) => ({
        nextZ: stackZ ? stackZ.nextZ : s.nextZ,
        items: s.items.map((item) => {
          if (!targetIds.has(item.id)) return item
          if (options.unstack) {
            const { stackGroupId: _g, stackName: _n, ...rest } = item
            return { ...rest, stacked: false } as CanvasItem
          }
          return {
            ...item,
            stackGroupId: options.stackGroupId,
            stacked: true,
            zIndex: stackZ?.zMap.get(item.id) ?? item.zIndex,
            ...(existingName ? { stackName: existingName } : {}),
          } as CanvasItem
        }),
      }))
    }

    set({
      animating: true,
      editingId: null,
      // Keep stack-name editor open when creating a stack; clear on unstack
      editingStackGroupId: options?.stackGroupId
        ? options.stackGroupId
        : options?.unstack
          ? null
          : get().editingStackGroupId,
    })
    const t0 = performance.now()

    const tick = (now: number) => {
      // Aborted by user interaction (e.g. started dragging)
      if (!get().animating) return

      const t = Math.min(1, (now - t0) / durationMs)
      const e = easeOutCubic(t)

      set((s) => ({
        items: s.items.map((item) => {
          const target = targetMap.get(item.id)
          const start = startMap.get(item.id)
          if (!target || !start) return item
          const endRot =
            target.rotation !== undefined ? target.rotation : start.rotation
          return {
            ...item,
            x: start.x + (target.x - start.x) * e,
            y: start.y + (target.y - start.y) * e,
            rotation: start.rotation + (endRot - start.rotation) * e,
            ...(target.width !== undefined ? { width: target.width } : {}),
            ...(target.height !== undefined ? { height: target.height } : {}),
            ...(options?.stackGroupId
              ? { stackGroupId: options.stackGroupId, stacked: true }
              : {}),
            ...(options?.unstack ? { stacked: false, rotation: endRot } : {}),
          }
        }),
      }))

      if (t < 1) {
        requestAnimationFrame(tick)
      } else {
        // Final cleanup: remove stackGroupId when unstacking
        if (options?.unstack) {
          set((s) => ({
            animating: false,
            editingStackGroupId: null,
            items: s.items.map((item) => {
              if (!targetIds.has(item.id)) return item
              const {
                stackGroupId: _g,
                stackName: _n,
                stackPreview: _p,
                ...rest
              } = item
              return { ...rest, stacked: false, rotation: 0 } as CanvasItem
            }),
          }))
          options.onComplete?.()
        } else if (options?.nestInto && options.stackGroupId) {
          // Fan anim done on parent → reparent into enterable stack.
          // Parent keeps fan poses in stackPreview; inner canvas uses free layout.
          // CRITICAL: do NOT leave stacked/stackGroupId on members — that would
          // re-draw a folder around the entire inner canvas.
          const live = get()
          const groupId = options.stackGroupId
          const parentId = options.nestInto.parentId
          const members = live.items
            .filter((i) => targetIds.has(i.id))
            .sort((a, b) => a.zIndex - b.zIndex)
          const folderBounds = stackGroupBounds(members)
          const folder = folderBounds ?? {
            x: members[0]?.x ?? 0,
            y: members[0]?.y ?? 0,
            width: 200,
            height: 200,
          }
          const zMin = Math.min(...members.map((m) => m.zIndex))
          const stack = createStackRecord(
            parentId,
            folder,
            zMin - 1,
            '',
            groupId,
          )
          // Inner canvas: tight shelf (user edits preserved after first enter)
          const laidOut = computeTightLayout(members, {
            originX: 0,
            originY: 0,
            gap: 12,
          })
          const layoutMap = new Map(laidOut.map((t) => [t.id, t]))

          set((s) => ({
            animating: false,
            dirty: true,
            stacks: s.stacks.some((st) => st.id === groupId)
              ? s.stacks.map((st) =>
                  st.id === groupId
                    ? {
                        ...st,
                        x: folder.x,
                        y: folder.y,
                        width: folder.width,
                        height: folder.height,
                        zIndex: zMin - 1,
                      }
                    : st,
                )
              : [...s.stacks, stack],
            items: s.items.map((item) => {
              if (!targetIds.has(item.id)) return item
              const t = layoutMap.get(item.id)
              return asFreeOnContainer(
                item,
                groupId,
                {
                  x: t?.x ?? 0,
                  y: t?.y ?? 0,
                  rotation: t?.rotation ?? 0,
                },
                {
                  // Fan pose left on the parent canvas
                  x: item.x,
                  y: item.y,
                  rotation: item.rotation ?? 0,
                },
              )
            }),
            selectedIds: [],
            selectedStackIds: [groupId],
            editingStackGroupId: groupId,
            editingId: null,
          }))
          options.onComplete?.()
        } else {
          set({ animating: false })
          options?.onComplete?.()
        }
      }
    }

    requestAnimationFrame(tick)
  },

  quickStack: () => {
    const parentId = get().currentContainerId
    // Free items on this canvas only (not already inside another stack)
    const selected = get()
      .getSelectedItems()
      .filter((i) => containerOf(i) === parentId && !i.stacked)
    if (selected.length < 2) return

    const groupId = uid('stack')
    // Fan + paint order both follow current z-order (highest z on top)
    const ordered = [...selected].sort((a, b) => a.zIndex - b.zIndex)
    // Classic fan animation on the parent canvas, then nest into enterable stack
    get().animateToLayout(computeQuickStack(ordered), 560, {
      stackGroupId: groupId,
      nestInto: { parentId },
    })
    set({ editingStackGroupId: groupId, editingId: null })
  },

  mergeIntoStack: (itemIds, groupId) => {
    if (itemIds.length === 0 || !groupId) return
    const state = get()
    if (state.animating) return

    const stack = state.stacks.find((s) => s.id === groupId)
    if (!stack) {
      // Legacy fan-stack merge path
      const members = state.items
        .filter((i) => i.stacked && i.stackGroupId === groupId)
        .sort((a, b) => a.zIndex - b.zIndex)
      if (members.length === 0) return
      const idSet = new Set(itemIds)
      const incoming = state.items.filter(
        (i) => idSet.has(i.id) && !i.stacked,
      )
      if (incoming.length === 0) return
      let z = state.nextZ
      const prep = new Map<string, number>()
      for (const m of members) prep.set(m.id, z++)
      for (const m of incoming) prep.set(m.id, z++)
      set((s) => ({
        nextZ: z,
        items: s.items.map((item) =>
          prep.has(item.id) ? { ...item, zIndex: prep.get(item.id)! } : item,
        ),
      }))
      const ordered = get()
        .items.filter((i) => prep.has(i.id))
        .sort((a, b) => a.zIndex - b.zIndex)
      get().animateToLayout(computeQuickStack(ordered), 420, {
        stackGroupId: groupId,
      })
      return
    }

    const idSet = new Set(itemIds)
    const incoming = state.items.filter(
      (i) => idSet.has(i.id) && containerOf(i) !== groupId && !i.stacked,
    )
    if (incoming.length === 0) return

    get().pushHistory()
    const existing = itemsInContainer(state.items, groupId).sort(
      (a, b) => a.zIndex - b.zIndex,
    )
    // Place new cards on top of the fan preview (parent world space)
    const previews = existing
      .map((m) => m.stackPreview)
      .filter(Boolean) as Array<{ x: number; y: number; rotation: number }>
    const baseX =
      previews.length > 0
        ? Math.max(...previews.map((p) => p.x))
        : stack.x + STACK_FOLDER_PAD
    const baseY =
      previews.length > 0
        ? Math.max(...previews.map((p) => p.y))
        : stack.y + STACK_FOLDER_PAD

    const maxY =
      existing.length > 0
        ? Math.max(...existing.map((i) => i.y + i.height))
        : 0
    let cursorX = 0
    let cursorY = existing.length > 0 ? maxY + 16 : 0
    let rowH = 0
    const maxRow = 640
    let z = state.nextZ
    const gap = 16

    const patches = new Map<
      string,
      {
        item: CanvasItem
        inner: { x: number; y: number; rotation: number }
        preview: { x: number; y: number; rotation: number }
        zIndex: number
      }
    >()
    let fanI = 0
    for (const item of incoming.sort((a, b) => a.zIndex - b.zIndex)) {
      if (cursorX > 0 && cursorX + item.width > maxRow) {
        cursorX = 0
        cursorY += rowH + 12
        rowH = 0
      }
      const offset = (existing.length + fanI) * gap
      const rot =
        fanI === 0 && existing.length === 0
          ? 0
          : Math.max(-8, Math.min(8, (item.id.charCodeAt(0) % 17) - 8))
      patches.set(item.id, {
        item,
        inner: { x: cursorX, y: cursorY, rotation: 0 },
        preview: {
          x: baseX + gap + offset * 0.15,
          y: baseY + gap * 0.75 + offset * 0.1,
          rotation: rot,
        },
        zIndex: z++,
      })
      cursorX += item.width + 12
      rowH = Math.max(rowH, item.height)
      fanI++
    }

    // Grow folder to cover new fan previews
    const previewItems = [
      ...existing.map((m) => ({
        x: m.stackPreview?.x ?? m.x,
        y: m.stackPreview?.y ?? m.y,
        width: m.width,
        height: m.height,
      })),
      ...[...patches.values()].map((p) => ({
        x: p.preview.x,
        y: p.preview.y,
        width: p.item.width,
        height: p.item.height,
      })),
    ]
    const minX = Math.min(...previewItems.map((i) => i.x)) - STACK_FOLDER_PAD
    const minY = Math.min(...previewItems.map((i) => i.y)) - STACK_FOLDER_PAD
    const maxX =
      Math.max(...previewItems.map((i) => i.x + i.width)) + STACK_FOLDER_PAD
    const maxY2 =
      Math.max(...previewItems.map((i) => i.y + i.height)) + STACK_FOLDER_PAD

    set((s) => ({
      dirty: true,
      nextZ: z,
      items: s.items.map((item) => {
        const p = patches.get(item.id)
        if (!p) return item
        return {
          ...asFreeOnContainer(item, groupId, p.inner, p.preview),
          zIndex: p.zIndex,
        }
      }),
      stacks: s.stacks.map((st) =>
        st.id === groupId
          ? {
              ...st,
              x: Math.min(st.x, minX),
              y: Math.min(st.y, minY),
              width: Math.max(st.width, maxX - Math.min(st.x, minX)),
              height: Math.max(st.height, maxY2 - Math.min(st.y, minY)),
            }
          : st,
      ),
      selectedIds: [],
      selectedStackIds: [groupId],
      editingId: null,
      editingStackGroupId: null,
    }))
  },

  dissolveSelectedStacks: () => {
    let { selectedStackIds, stacks, items, currentContainerId } = get()

    // Also accept legacy/mid-anim selection: all selected free items share one stackGroupId
    if (selectedStackIds.length === 0) {
      const selected = get().getSelectedItems()
      const gids = [
        ...new Set(
          selected
            .filter((i) => i.stacked && i.stackGroupId)
            .map((i) => i.stackGroupId!),
        ),
      ]
      if (
        gids.length === 1 &&
        selected.length > 0 &&
        selected.every((i) => i.stacked && i.stackGroupId === gids[0])
      ) {
        selectedStackIds = gids
      }
    }

    if (selectedStackIds.length === 0) return
    if (get().animating) return
    get().pushHistory()

    let nextItems = [...items]
    let nextStacks = [...stacks]
    const parentId = currentContainerId
    const releasedIds: string[] = []

    for (const sid of selectedStackIds) {
      const stack = nextStacks.find((s) => s.id === sid)
      // Nested StackRecord dissolve → free items at fan (preview) pose
      if (stack && stack.parentId === parentId) {
        const ox = stack.x + STACK_FOLDER_PAD
        const oy = stack.y + STACK_FOLDER_PAD
        const promotedChildStackIds = new Set(
          nextStacks
            .filter((candidate) => candidate.parentId === sid)
            .map((candidate) => candidate.id),
        )
        nextItems = nextItems.map((it) => {
          const containerId = containerOf(it)
          if (containerId === sid) {
            releasedIds.push(it.id)
            const px = it.stackPreview?.x
            const py = it.stackPreview?.y
            const prot = it.stackPreview?.rotation
            return asFreeOnContainer(
              it,
              parentId,
              {
                x: px ?? it.x + ox,
                y: py ?? it.y + oy,
                rotation: prot ?? 0,
              },
              null,
            )
          }
          // A direct child stack is promoted to our parent below. Its direct
          // leaves keep living in that child, but their fan pose changes from
          // the dissolved stack's coordinate space to the new parent space.
          if (promotedChildStackIds.has(containerId) && it.stackPreview) {
            return {
              ...it,
              stackPreview: {
                ...it.stackPreview,
                x: it.stackPreview.x + ox,
                y: it.stackPreview.y + oy,
              },
            }
          }
          return it
        })
        nextStacks = nextStacks
          .filter((s) => s.id !== sid)
          .map((s) =>
            s.parentId === sid
              ? { ...s, parentId, x: s.x + ox, y: s.y + oy }
              : s,
          )
        continue
      }

      // Legacy same-canvas fan (no StackRecord yet / mid-animation)
      nextItems = nextItems.map((it) => {
        if (!(it.stacked && it.stackGroupId === sid)) return it
        releasedIds.push(it.id)
        return asFreeOnContainer(
          it,
          containerOf(it),
          { x: it.x, y: it.y, rotation: it.rotation ?? 0 },
          null,
        )
      })
    }

    const uniqueIds = [...new Set(releasedIds)]
    set({
      dirty: true,
      items: nextItems,
      stacks: nextStacks,
      selectedIds: uniqueIds,
      selectedStackIds: [],
      editingStackGroupId: null,
      animating: false,
    })

    // Smooth fan → tight shelf (classic Alt+G motion)
    const free = get().items.filter((i) => uniqueIds.includes(i.id))
    if (free.length >= 2) {
      const originX = Math.min(...free.map((i) => i.x))
      const originY = Math.min(...free.map((i) => i.y))
      get().animateToLayout(
        computeSmoothLayout(free, {
          originX,
          originY,
          gapX: 4,
          gapY: 4,
        }),
        520,
        { unstack: true, skipHistory: true },
      )
    } else if (free.length === 1) {
      get().updateItem(free[0].id, { rotation: 0 })
    }
  },

  smoothLayout: () => {
    // Alt+G: unstack selected folder(s) or legacy fan group
    const stackSel = get().selectedStackIds
    const selected = get().getSelectedItems()
    const legacyGids = [
      ...new Set(
        selected
          .filter((i) => i.stacked && i.stackGroupId)
          .map((i) => i.stackGroupId!),
      ),
    ]
    const pureLegacyStack =
      legacyGids.length === 1 &&
      selected.length >= 1 &&
      selected.every((i) => i.stacked && i.stackGroupId === legacyGids[0])

    if (stackSel.length > 0 || pureLegacyStack) {
      get().dissolveSelectedStacks()
      return
    }

    const items = selected
    if (items.length < 2) return
    const originX = Math.min(...items.map((i) => i.x))
    const originY = Math.min(...items.map((i) => i.y))
    get().animateToLayout(
      computeSmoothLayout(items, { originX, originY, gapX: 4, gapY: 4 }),
      520,
      { unstack: true },
    )
  },

  rowLayout: () => {
    const items = get().getSelectedItems()
    if (items.length < 2) return
    get().animateToLayout(computeRowLayout(items), 520, { unstack: true })
  },

  getSelectedItems: () => {
    const { items, selectedIds } = get()
    const setIds = new Set(selectedIds)
    return items.filter((i) => setIds.has(i.id))
  },

  exportBoard: () => {
    const {
      items,
      stacks,
      viewport,
      homeViewport,
      nextZ,
      boardName,
      currentContainerId,
    } = get()
    return {
      version: 1 as const,
      name: boardName,
      viewport: { ...viewport },
      homeViewport: {
        ...(currentContainerId === ROOT_CONTAINER_ID ? viewport : homeViewport),
      },
      items: cloneItems(items),
      nextZ,
      stacks: cloneStacks(stacks),
      currentContainerId,
    }
  },

  importBoard: (board) => {
    const normalized = normalizeImportedItems(board.items)
    const migrated = migrateLegacyStacks(normalized, board.stacks ?? [])
    const currentContainerId = board.currentContainerId || ROOT_CONTAINER_ID
    const homeViewport =
      currentContainerId === ROOT_CONTAINER_ID
        ? { ...board.viewport }
        : board.homeViewport
          ? { ...board.homeViewport }
          : { ...DEFAULT_VIEWPORT }
    set({
      items: migrated.items,
      stacks: migrated.stacks,
      currentContainerId,
      viewport: { ...board.viewport },
      homeViewport,
      nextZ: board.nextZ,
      boardName: board.name || 'Untitled Board',
      selectedIds: [],
      selectedStackIds: [],
      editingId: null,
      editingStackGroupId: null,
      stackEnterAnim: null,
      history: [],
      future: [],
      dirty: false,
    })
  },
}))

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
