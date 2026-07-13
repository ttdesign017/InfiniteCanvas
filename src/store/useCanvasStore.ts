import { create } from 'zustand'
import type {
  BoardSnapshot,
  CanvasItem,
  CropRect,
  LinkCardItem,
  Point,
  ScribbleItem,
  ScribblePath,
  TextCardItem,
  TextItem,
  Tool,
  Viewport,
} from '../types/canvas'
import { uid } from '../utils/id'
import {
  allContentBounds,
  computeQuickStack,
  computeRowLayout,
  computeSmoothLayout,
  type LayoutTarget,
} from '../utils/layout'
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
  nextZ: number
}

interface CanvasState {
  items: CanvasItem[]
  selectedIds: string[]
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
  animating: boolean
  /** Item currently in inline edit mode (text / textcard) */
  editingId: string | null
  /** Stack folder tab name being edited (stackGroupId) */
  editingStackGroupId: string | null
  /** Snap selection edges to nearby item edges while moving */
  snapEnabled: boolean
  history: HistoryEntry[]
  future: HistoryEntry[]

  setTool: (tool: Tool) => void
  setEditingId: (id: string | null) => void
  setEditingStackGroupId: (groupId: string | null) => void
  /** Rename a stack folder tab (writes stackName onto all members) */
  commitStackName: (groupId: string, name: string) => void
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
  clearSelection: () => void
  toggleSelect: (id: string) => void
  selectAll: () => void

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

  addText: (world: Point, options?: { content?: string; width?: number; height?: number }) => void
  addTextCard: (
    world: Point,
    options?: { content?: string; width?: number; height?: number },
  ) => void
  addLinkCard: (world: Point, url?: string) => void
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
    options?: { stackGroupId?: string; unstack?: boolean },
  ) => void
  quickStack: () => void
  smoothLayout: (columns?: number) => void
  rowLayout: () => void

  getSelectedItems: () => CanvasItem[]
  exportBoard: () => BoardSnapshot
  importBoard: (board: BoardSnapshot) => void
}

function cloneItems(items: CanvasItem[]): CanvasItem[] {
  return structuredClone(items)
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
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
  selectedIds: [],
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
  animating: false,
  editingId: null,
  editingStackGroupId: null,
  snapEnabled: true,
  history: [],
  future: [],

  setTool: (tool) => set({ tool, editingId: null, editingStackGroupId: null }),
  setEditingId: (id) => set({ editingId: id, editingStackGroupId: null }),
  setEditingStackGroupId: (groupId) =>
    set({ editingStackGroupId: groupId, editingId: null }),
  commitStackName: (groupId, name) => {
    const trimmed = name.trim()
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
    const items = get().items
    if (items.length === 0) {
      set({ viewport: { ...DEFAULT_VIEWPORT } })
      return
    }
    const bounds = allContentBounds(items)
    if (!bounds || bounds.width < 1 || bounds.height < 1) {
      set({ viewport: { ...DEFAULT_VIEWPORT } })
      return
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

      const zOf = (id: string) => s.items.find((i) => i.id === id)?.zIndex ?? 0
      const isStackedId = (id: string) => {
        const it = s.items.find((i) => i.id === id)
        return !!(it?.stacked && it.stackGroupId)
      }

      // Always raise as a block preserving existing relative z-order first
      const order = [...selectedIds].sort((a, b) => zOf(a) - zOf(b))

      // Only a single free (non-stacked) click promotes that item to top —
      // marquee / multi-select must NOT scramble prior z-order.
      const singleFreeClick =
        ids.length === 1 &&
        selectedIds.includes(ids[0]) &&
        !isStackedId(ids[0])
      if (singleFreeClick) {
        const id = ids[0]
        const idx = order.indexOf(id)
        if (idx >= 0) {
          order.splice(idx, 1)
          order.push(id)
        }
      }

      // Pure stack selection: never reshuffle internals
      if (selectedIds.every(isStackedId)) {
        order.sort((a, b) => zOf(a) - zOf(b))
      }

      let z = s.nextZ
      const zMap = new Map<string, number>()
      for (const id of order) {
        zMap.set(id, z++)
      }

      return {
        selectedIds,
        editingId: null,
        nextZ: z,
        items: s.items.map((item) =>
          zMap.has(item.id) ? { ...item, zIndex: zMap.get(item.id)! } : item,
        ),
      }
    }),

  clearSelection: () => set({ selectedIds: [], editingId: null }),

  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),

  selectAll: () => set((s) => ({ selectedIds: s.items.map((i) => i.id) })),

  pushHistory: () => {
    const { items, nextZ, history } = get()
    const entry: HistoryEntry = { items: cloneItems(items), nextZ }
    set({
      history: [...history.slice(-49), entry],
      future: [],
    })
  },

  undo: () => {
    const { history, items, nextZ, future } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({
      history: history.slice(0, -1),
      future: [...future, { items: cloneItems(items), nextZ }],
      items: prev.items,
      nextZ: prev.nextZ,
      selectedIds: [],
    })
  },

  redo: () => {
    const { future, items, nextZ, history } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    set({
      future: future.slice(0, -1),
      history: [...history, { items: cloneItems(items), nextZ }],
      items: next.items,
      nextZ: next.nextZ,
      selectedIds: [],
    })
  },

  addItems: (newItems, select = true) => {
    get().pushHistory()
    set((s) => ({
      items: [...s.items, ...newItems],
      nextZ: Math.max(s.nextZ, ...newItems.map((i) => i.zIndex + 1)),
      selectedIds: select ? newItems.map((i) => i.id) : s.selectedIds,
    }))
  },

  updateItem: (id, patch) =>
    set((s) => ({
      items: s.items.map((item) =>
        item.id === id ? ({ ...item, ...patch } as CanvasItem) : item,
      ),
    })),

  updateItems: (patches) => {
    const map = new Map(patches.map((p) => [p.id, p.patch]))
    set((s) => ({
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
    const { selectedIds, editingStackGroupId, items } = get()
    if (selectedIds.length === 0) return
    get().pushHistory()
    const idSet = new Set(selectedIds)
    // Drop name editor if the edited stack is fully removed
    let clearNameEdit = false
    if (editingStackGroupId) {
      const remaining = items.some(
        (i) =>
          !idSet.has(i.id) &&
          i.stacked &&
          i.stackGroupId === editingStackGroupId,
      )
      clearNameEdit = !remaining
    }
    set((s) => ({
      items: s.items.filter((i) => !idSet.has(i.id)),
      selectedIds: [],
      editingStackGroupId: clearNameEdit ? null : s.editingStackGroupId,
    }))
  },

  bringToFront: (ids) => {
    const target = ids ?? get().selectedIds
    if (target.length === 0) return
    get().pushHistory()
    let z = get().nextZ
    const idSet = new Set(target)
    set((s) => ({
      items: s.items.map((item) => {
        if (!idSet.has(item.id)) return item
        return { ...item, zIndex: z++ }
      }),
      nextZ: z,
    }))
  },

  sendToBack: (ids) => {
    const target = ids ?? get().selectedIds
    if (target.length === 0) return
    get().pushHistory()
    const minZ = Math.min(...get().items.map((i) => i.zIndex), 1)
    let z = minZ - target.length
    const idSet = new Set(target)
    set((s) => ({
      items: s.items.map((item) => {
        if (!idSet.has(item.id)) return item
        return { ...item, zIndex: z++ }
      }),
    }))
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
    const item: TextItem = {
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
    }
    set((s) => ({
      items: [...s.items, item],
      nextZ: z + 1,
      selectedIds: [item.id],
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
    // Default / paste size — 4:3, ~75% of previous default (320×240 → 240×180)
    let width = options?.width ?? 240
    let height = options?.height ?? 180
    if (content.length > 0 && options?.width == null && options?.height == null) {
      const lines = content.split(/\r?\n/)
      const longest = Math.max(...lines.map((l) => l.length), 12)
      // Base width from content, then lock 4:3, then 75% scale
      width = Math.min(360, Math.max(210, (longest * 7 + 48) * 0.75))
      height = Math.round((width * 3) / 4)
      const needH = Math.min(320, Math.max(height, lines.length * 16 + 42))
      if (needH > height) {
        height = needH
        width = Math.round((height * 4) / 3)
      }
    }
    const item: TextCardItem = {
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
    }
    set((s) => ({
      items: [...s.items, item],
      nextZ: z + 1,
      selectedIds: [item.id],
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
    const ids = [...get().selectedIds]
    if (ids.length < 2) return
    const patches = computeAlignPatches(ids, get().items, mode)
    if (!patches.length) return
    get().pushHistory()
    // Sum deltas per id (stack members share the same body delta)
    const map = new Map<string, { dx: number; dy: number }>()
    for (const p of patches) {
      const cur = map.get(p.id) || { dx: 0, dy: 0 }
      map.set(p.id, { dx: cur.dx + p.dx, dy: cur.dy + p.dy })
    }
    // Apply absolute positions from live items
    const live = get().items
    set({
      items: live.map((item) => {
        const d = map.get(item.id)
        if (!d || (d.dx === 0 && d.dy === 0)) return item
        return { ...item, x: item.x + d.dx, y: item.y + d.dy }
      }),
    })
  },

  packSelected: (dir: PackDir) => {
    const ids = [...get().selectedIds]
    if (ids.length < 2) return
    const patches = computePackPatches(ids, get().items, dir)
    if (!patches.length) return
    get().pushHistory()
    const map = new Map<string, { dx: number; dy: number }>()
    for (const p of patches) {
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
  },

  addLinkCard: (world, url = '') => {
    get().pushHistory()
    const z = get().nextZ
    const normalized = url ? normalizeUrl(url) : ''
    // Notion-style bookmark: width ~1.4× original 340, fixed height 160
    const item: LinkCardItem = {
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
    }
    set((s) => ({
      items: [...s.items, item],
      nextZ: z + 1,
      selectedIds: [item.id],
      tool: 'select',
    }))
  },

  startScribble: (world) => {
    get().pushHistory()
    const z = get().nextZ
    const pad = Math.max(get().scribbleWidth, 8)
    // Local coords: first point at (pad, pad)
    const path: ScribblePath = {
      id: uid('path'),
      points: [{ x: pad, y: pad }],
      color: get().scribbleColor,
      width: get().scribbleWidth,
    }
    const item: ScribbleItem = {
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
    }
    set((s) => ({
      items: [...s.items, item],
      nextZ: z + 1,
      activeScribbleId: item.id,
      selectedIds: [item.id],
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
    if (state.animating) return
    state.pushHistory()

    const startMap = new Map(
      state.items.map((i) => [i.id, { x: i.x, y: i.y, rotation: i.rotation ?? 0 }]),
    )
    const targetMap = new Map(targets.map((t) => [t.id, t]))
    const targetIds = new Set(targets.map((t) => t.id))

    // Apply stack membership immediately so group-move works mid-animation.
    // When stacking, lock z-order to match pre-stack order (low → bottom, high → top).
    if (options?.stackGroupId || options?.unstack) {
      const orderedStack = state.items
        .filter((i) => targetIds.has(i.id))
        .sort((a, b) => a.zIndex - b.zIndex)
      let zLock = state.nextZ
      const stackZ = new Map(
        options?.stackGroupId
          ? orderedStack.map((i) => [i.id, zLock++])
          : [],
      )

      set((s) => ({
        nextZ: options?.stackGroupId ? zLock : s.nextZ,
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
            zIndex: stackZ.get(item.id) ?? item.zIndex,
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
              const { stackGroupId: _g, stackName: _n, ...rest } = item
              return { ...rest, stacked: false, rotation: 0 } as CanvasItem
            }),
          }))
        } else {
          set({ animating: false })
        }
      }
    }

    requestAnimationFrame(tick)
  },

  quickStack: () => {
    const items = get().getSelectedItems()
    if (items.length < 2) return
    const groupId = uid('stack')
    // Fan + paint order both follow current z-order (last-raised / highest z on top)
    const ordered = [...items].sort((a, b) => a.zIndex - b.zIndex)
    get().animateToLayout(computeQuickStack(ordered), 560, { stackGroupId: groupId })
    // Enter name edit after layout starts; do not block the first drag
    set({ editingStackGroupId: groupId, editingId: null })
  },

  smoothLayout: () => {
    const items = get().getSelectedItems()
    if (items.length < 2) return
    // Tight shelf-pack toward selection top-left; order by zIndex
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
    const { items, viewport, nextZ, boardName } = get()
    return {
      version: 1 as const,
      name: boardName,
      viewport: { ...viewport },
      items: cloneItems(items),
      nextZ,
    }
  },

  importBoard: (board) => {
    get().pushHistory()
    set({
      items: normalizeImportedItems(board.items),
      viewport: board.viewport,
      nextZ: board.nextZ,
      boardName: board.name || 'Untitled Board',
      selectedIds: [],
      editingId: null,
      editingStackGroupId: null,
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
