import type { CanvasItem, CropRect, LinkCardItem, ScribbleItem, ScribblePath, TextCardItem, TextItem, EmbedItem } from '../../types/canvas'
import { uid } from '../../utils/id'
import { containerOf } from '../../utils/stacks'
import { faviconFor, guessTitleFromUrl, normalizeUrl } from '../../utils/linkMeta'
import { eraseFromPaths, recomputeScribbleBounds } from '../../utils/scribble'
import { applyWorldCrop, isAxisAlignedForCrop, uncropFrame } from '../../utils/crop'
import { computeAlignPatches, computePackPatches } from '../../utils/align'
import { applyItemPatch, applyItemPatches } from '../itemPatch'
import { revokeUnreferencedBlobs } from '../../utils/blobUrls'
import { type AlignMode, type PackDir } from '../../utils/align'
import {
  blobUrlsStillReachable,
  tagContainer,
  measureNoteCardHeight,
  measurePlainTextSize,
  resolveNoteCardWidth,
  NOTE_CARD_DEFAULT_HEIGHT,
  LINK_CARD_DEFAULT_WIDTH,
  extractHost,
} from '../actionHelpers'
import {
  loadBoardIntoRuntimeFields,
  snapshotBoard,
} from '../../utils/boardDocument'
import { resetStackAnimProgress } from '../../utils/stackAnimProgress'
import { FONT_STACKS } from '../canvasStoreTypes'
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'

export type DocumentActionKey =
  | 'addItems'
  | 'updateItem'
  | 'updateItems'
  | 'moveItems'
  | 'resizeItem'
  | 'addText'
  | 'addTextCard'
  | 'convertTextKind'
  | 'alignSelected'
  | 'packSelected'
  | 'flipSelectedMedia'
  | 'addEmbed'
  | 'addLinkCard'
  | 'startScribble'
  | 'appendScribblePoint'
  | 'endScribble'
  | 'finalizeScribbleLayer'
  | 'enterScribbleEdit'
  | 'eraseAt'
  | 'applyCrop'
  | 'restoreCrop'
  | 'restoreRotation'
  | 'restoreNativeScale'
  | 'exportBoard'
  | 'importBoard'
  | 'setBoardFilePath'
  | 'setBoardName'

export function createDocumentActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, DocumentActionKey> {
  return {
  setBoardFilePath: (path) => set({ boardFilePath: path }),

  setBoardName: (name) => set({ boardName: name, dirty: true }),


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


  updateItem: (id, patch, options) => {
    if (options?.history) get().pushHistory()
    const markDirty = options?.dirty !== false
    set((s) => {
      const prev = s.items.find((i) => i.id === id)
      const items = applyItemPatch(s.items, id, patch)
      if (items === s.items) return {}
      // Revoke replaced blob URLs only when no history entry still needs them
      if (prev) {
        const next = items.find((i) => i.id === id)
        const mediaSrcChanged =
          (prev.type === 'image' ||
            prev.type === 'gif' ||
            prev.type === 'video' ||
            prev.type === 'audio') &&
          next &&
          'src' in next &&
          prev.src !== (next as { src: string }).src
        const linkImgChanged =
          prev.type === 'link' &&
          next?.type === 'link' &&
          (prev.image !== next.image || prev.favicon !== next.favicon)
        if (mediaSrcChanged || linkImgChanged) {
          const keep = blobUrlsStillReachable(items, s.history, s.future)
          revokeUnreferencedBlobs([prev], keep)
        }
      }
      return markDirty ? { items, dirty: true } : { items }
    })
  },


  updateItems: (patches, options) => {
    if (patches.length === 0) return
    if (options?.history) get().pushHistory()
    const markDirty = options?.dirty !== false
    set((s) => {
      const items = applyItemPatches(s.items, patches)
      if (items === s.items) return {}
      return markDirty ? { items, dirty: true } : { items }
    })
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
    // Short notes stay compact (240); long pastes use link-card width (476)
    // and full content-driven height (no 900px hard clip).
    const width = resolveNoteCardWidth(content, options?.width)
    let height = options?.height ?? NOTE_CARD_DEFAULT_HEIGHT
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
        const content = item.content ?? ''
        const fontSize = Math.max(14, item.fontSize || 14)
        const fontFamily = FONT_STACKS[0].value
        // Wrap near the note's width so long notes don't become one ultra-wide line
        const maxWidth = Math.max(160, Math.min(900, item.width))
        const size = measurePlainTextSize(content, {
          fontSize,
          fontFamily,
          fontWeight: 500,
          maxWidth,
          minWidth: 48,
          minHeight: 28,
        })
        const next: TextItem = {
          id: item.id,
          type: 'text',
          x: item.x,
          y: item.y,
          width: size.width,
          height: size.height,
          rotation: item.rotation ?? 0,
          zIndex: item.zIndex,
          content,
          fontSize,
          fontFamily,
          fontWeight: 500,
          color: item.color || '#1e1e1e',
          backgroundColor: 'transparent',
          locked: item.locked,
          ...(item.containerId ? { containerId: item.containerId } : {}),
        }
        return next
      }
      if (to === 'textcard' && item.type === 'text') {
        changed = true
        const content = item.content ?? ''
        const fontSize = Math.min(18, Math.max(12, item.fontSize || 14))
        // Content-driven note size (same rules as paste / long-article notes)
        const width = resolveNoteCardWidth(content)
        const height =
          content.trim().length > 0
            ? measureNoteCardHeight(content, width, fontSize)
            : NOTE_CARD_DEFAULT_HEIGHT
        const next: TextCardItem = {
          id: item.id,
          type: 'textcard',
          x: item.x,
          y: item.y,
          width: Math.max(120, width),
          height: Math.max(80, height),
          rotation: item.rotation ?? 0,
          zIndex: item.zIndex,
          content,
          fontSize,
          color: item.color || '#6b6b6b',
          backgroundColor: '#ffffff',
          labelColor: '#8c8c8c',
          labelBackground: 'transparent',
          locked: item.locked,
          ...(item.containerId ? { containerId: item.containerId } : {}),
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


  flipSelectedMedia: (axis) => {
    const s = get()
    const idSet = new Set(s.selectedIds)
    if (idSet.size === 0) return
    const targets = s.items.filter(
      (i) =>
        idSet.has(i.id) &&
        !i.locked &&
        (i.type === 'image' || i.type === 'gif' || i.type === 'video'),
    )
    if (targets.length === 0) return
    get().pushHistory()
    set({
      dirty: true,
      items: s.items.map((item) => {
        if (!idSet.has(item.id)) return item
        if (item.type !== 'image' && item.type !== 'gif' && item.type !== 'video')
          return item
        if (item.locked) return item
        if (axis === 'x') {
          return { ...item, flipX: !item.flipX }
        }
        return { ...item, flipY: !item.flipY }
      }),
    })
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
        width: LINK_CARD_DEFAULT_WIDTH,
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
    const state = get()
    const pad = Math.max(state.scribbleWidth, 8)
    const color = state.scribbleColor
    const width = state.scribbleWidth

    // Continue the open layer session when present
    const existingId = state.activeScribbleId
    const existing = existingId
      ? state.items.find(
          (i): i is ScribbleItem => i.id === existingId && i.type === 'scribble',
        )
      : undefined

    if (existing) {
      get().pushHistory()
      const newPath: ScribblePath = {
        id: uid('path'),
        // Temporary local; bounds recompute maps everything to world then back
        points: [{ x: world.x - existing.x, y: world.y - existing.y }],
        color,
        width,
      }
      const paths = [...existing.paths, newPath]
      const worldPaths = paths.map((p) => ({
        ...p,
        points: p.points.map((pt) => ({
          x: pt.x + existing.x,
          y: pt.y + existing.y,
        })),
      }))
      const boundsPad = Math.max(
        width,
        existing.strokeWidth,
        ...paths.map((p) => p.width),
        8,
      )
      const bounds = recomputeScribbleBounds(worldPaths, boundsPad)
      if (!bounds) return existing.id

      set((s) => ({
        dirty: true,
        items: s.items.map((item) =>
          item.id === existing.id
            ? {
                ...item,
                paths: bounds.paths,
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                strokeColor: color,
                strokeWidth: width,
              }
            : item,
        ),
        activeScribbleId: existing.id,
        // Keep selection on the layer for move/delete, but pen toolbar uses store style
        selectedIds: [existing.id],
        selectedStackIds: [],
      }))
      return existing.id
    }

    // New layer for this pen-tool session
    get().pushHistory()
    const z = get().nextZ
    const containerId = get().currentContainerId
    const path: ScribblePath = {
      id: uid('path'),
      points: [{ x: pad, y: pad }],
      color,
      width,
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
        strokeColor: color,
        strokeWidth: width,
      },
      containerId,
    )
    set((s) => ({
      dirty: true,
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
      dirty: true,
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
        const pad = Math.max(
          item.strokeWidth,
          ...paths.map((p) => p.width),
          8,
        )
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


  /**
   * Stroke finished (pointer up). Layer session stays open so the next stroke
   * still appends to the same scribble item.
   */
  endScribble: () => {
    /* intentionally keep activeScribbleId */
  },


  finalizeScribbleLayer: () => {
    if (!get().activeScribbleId) return
    set({ activeScribbleId: null })
  },


  enterScribbleEdit: (id) => {
    const item = get().items.find((i) => i.id === id && i.type === 'scribble')
    if (!item || item.stacked) return
    set({
      tool: 'scribble',
      activeScribbleId: id,
      selectedIds: [id],
      selectedStackIds: [],
      editingId: null,
      editingStackGroupId: null,
    })
  },


  eraseAt: (world, radius) => {
    const r = radius ?? get().eraseWidth
    set((s) => {
      const nextItems = s.items
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
        .filter(Boolean) as CanvasItem[]

      const activeStillExists =
        !!s.activeScribbleId &&
        nextItems.some((i) => i.id === s.activeScribbleId)

      return {
        dirty: true,
        items: nextItems,
        selectedIds: s.selectedIds.filter((id) =>
          nextItems.some((i) => i.id === id),
        ),
        activeScribbleId: activeStillExists ? s.activeScribbleId : null,
      }
    })
  },


  applyCrop: (ids, worldRect) => {
    const s = get()
    const idList = Array.isArray(ids) ? ids : [ids]
    if (idList.length === 0) return 0

    type Patch = {
      id: string
      crop: CropRect
      width: number
      height: number
      x: number
      y: number
    }
    const patches: Patch[] = []

    for (const id of idList) {
      const item = s.items.find((i) => i.id === id)
      if (
        !item ||
        (item.type !== 'image' && item.type !== 'gif' && item.type !== 'video')
      ) {
        continue
      }
      if (item.stacked) continue
      if (containerOf(item) !== s.currentContainerId) continue
      // Rotated media cannot be cropped — caller should toast + Alt+R
      if (!isAxisAlignedForCrop(item)) continue

      const result = applyWorldCrop(item, worldRect)
      if (!result) continue
      patches.push({
        id,
        crop: result.crop as CropRect,
        width: result.width,
        height: result.height,
        x: result.x,
        y: result.y,
      })
    }

    if (patches.length === 0) return 0

    get().pushHistory()
    const byId = new Map(patches.map((p) => [p.id, p]))
    set((st) => ({
      dirty: true,
      items: st.items.map((it) => {
        const p = byId.get(it.id)
        if (!p) return it
        if (it.type !== 'image' && it.type !== 'gif' && it.type !== 'video')
          return it
        const { clipPolygon: _drop, ...base } = it
        return {
          ...base,
          crop: p.crop,
          width: p.width,
          height: p.height,
          x: p.x,
          y: p.y,
        } as typeof it
      }),
    }))
    return patches.length
  },


  restoreCrop: (ids) => {
    const targetIds = ids ?? get().selectedIds
    const media = get().items.filter(
      (i) =>
        targetIds.includes(i.id) &&
        (i.type === 'image' || i.type === 'gif' || i.type === 'video') &&
        !i.stacked &&
        ((i.crop &&
          (i.crop.w < 0.999 ||
            i.crop.h < 0.999 ||
            i.crop.x > 0.001 ||
            i.crop.y > 0.001)) ||
          (i.clipPolygon && i.clipPolygon.length >= 3)),
    )
    if (media.length === 0) return
    get().pushHistory()
    set((s) => ({
      dirty: true,
      items: s.items.map((item) => {
        if (
          item.type !== 'image' &&
          item.type !== 'gif' &&
          item.type !== 'video'
        ) {
          return item
        }
        if (!targetIds.includes(item.id)) return item
        if (!item.crop && !(item.clipPolygon && item.clipPolygon.length >= 3))
          return item
        // Uncrop: expand frame, keep visible content + rotation fixed in world
        // (accounts for CSS transform-origin: center under any rotation).
        if (item.crop) {
          const frame = uncropFrame(item)
          const { clipPolygon: _c, crop: _cr, ...rest } = item
          if (!frame) {
            return rest as typeof item
          }
          return {
            ...rest,
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            // rotation intentionally unchanged
          } as typeof item
        }
        const { clipPolygon: _c, ...rest } = item
        return rest as typeof item
      }),
    }))
  },


  restoreRotation: (ids) => {
    const targetIds = ids ?? get().selectedIds
    const targets = get().items.filter(
      (i) =>
        targetIds.includes(i.id) &&
        !i.stacked &&
        Math.abs(i.rotation ?? 0) > 0.001,
    )
    if (targets.length === 0) return
    get().pushHistory()
    const idSet = new Set(targets.map((t) => t.id))
    set((s) => ({
      dirty: true,
      items: s.items.map((item) =>
        idSet.has(item.id) ? { ...item, rotation: 0 } : item,
      ),
    }))
  },


  restoreNativeScale: (ids) => {
    const targetIds = ids ?? get().selectedIds
    const media = get().items.filter(
      (i) =>
        targetIds.includes(i.id) &&
        !i.stacked &&
        (i.type === 'image' || i.type === 'gif' || i.type === 'video') &&
        i.naturalWidth > 0 &&
        i.naturalHeight > 0,
    )
    if (media.length === 0) return

    // Only push history if any size actually changes
    let anyChange = false
    for (const item of media) {
      if (item.type !== 'image' && item.type !== 'gif' && item.type !== 'video')
        continue
      const cropW = item.crop?.w ?? 1
      const cropH = item.crop?.h ?? 1
      const nw = Math.max(24, Math.round(item.naturalWidth * cropW))
      const nh = Math.max(24, Math.round(item.naturalHeight * cropH))

      if (Math.abs(item.width - nw) > 0.5 || Math.abs(item.height - nh) > 0.5) {
        anyChange = true
        break
      }
    }
    if (!anyChange) return

    get().pushHistory()
    const idSet = new Set(media.map((m) => m.id))
    set((s) => ({
      dirty: true,
      items: s.items.map((item) => {
        if (!idSet.has(item.id)) return item
        if (
          item.type !== 'image' &&
          item.type !== 'gif' &&
          item.type !== 'video'
        ) {
          return item
        }
        const cropW = item.crop?.w ?? 1
        const cropH = item.crop?.h ?? 1
        // Visible region at 1:1 source pixels (respect current crop)
        const nw = Math.max(24, Math.round(item.naturalWidth * cropW))
        const nh = Math.max(24, Math.round(item.naturalHeight * cropH))
        const cx = item.x + item.width / 2
        const cy = item.y + item.height / 2
        return {
          ...item,
          width: nw,
          height: nh,
          x: cx - nw / 2,
          y: cy - nh / 2,
        }
      }),
    }))
  },


  exportBoard: () => snapshotBoard(get()),

  importBoard: (board) => {
    // Drop locks + revoke blobs + hydrate media + reflow stack z (boardDocument)
    const ready = loadBoardIntoRuntimeFields(board)
    resetStackAnimProgress()
    set({
      items: ready.items,
      stacks: ready.stacks,
      currentContainerId: ready.currentContainerId,
      viewport: ready.viewport,
      homeViewport: ready.homeViewport,
      nextZ: ready.nextZ,
      boardName: ready.boardName,
      selectedIds: [],
      selectedStackIds: [],
      editingId: null,
      editingStackGroupId: null,
      activeScribbleId: null,
      animating: false,
      stackEnterAnim: null,
      pendingNavigation: null,
      history: [],
      future: [],
      dirty: false,
    })
  },
  }
}
