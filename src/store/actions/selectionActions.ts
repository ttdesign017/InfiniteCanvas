import type { CanvasItem, StackRecord } from '../../types/canvas'
import { uid } from '../../utils/id'
import { allocateNestedStackTreeZ, raiseSelectionZ } from '../../utils/zOrder'
import { collectDescendantStackIds, containerOf, itemsInContainer, stacksInContainer } from '../../utils/stacks'
import { cloneItemsDeep, cloneStacksDeep } from '../cloneDocument'
import { revokeUnreferencedBlobs } from '../../utils/blobUrls'
import { blobUrlsStillReachable, itemZChanged, stackZChanged, tagContainer } from '../actionHelpers'
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'

export type SelectionActionKey =
  | 'select'
  | 'clearSelection'
  | 'toggleSelect'
  | 'selectStacks'
  | 'selectBodies'
  | 'selectAll'
  | 'deleteSelected'
  | 'hasClipboard'
  | 'clearClipboard'
  | 'copySelection'
  | 'cutSelection'
  | 'pasteClipboard'
  | 'duplicateBodies'
  | 'bringToFront'
  | 'sendToBack'
  | 'duplicateItems'
  | 'getSelectedItems'

type CanvasClipboard = {
  mode: 'copy' | 'cut'
  items: CanvasItem[]
  stacks: StackRecord[]
  /** Container the free/top-level bodies came from */
  sourceContainerId: string
}

let canvasClipboard: CanvasClipboard | null = null

function cloneBodiesIntoCanvas(
  get: GetState,
  set: SetState,
  srcItems: CanvasItem[],
  srcStacks: StackRecord[],
  options: {
    recenter?: boolean
    select?: boolean
    dx?: number
    dy?: number
  },
): { itemIds: string[]; stackIds: string[] } | null {
  if (srcItems.length === 0 && srcStacks.length === 0) return null
  const s = get()
  const targetContainer = s.currentContainerId

  const stackIdMap = new Map<string, string>()
  for (const st of srcStacks) {
    stackIdMap.set(st.id, uid('stack'))
  }
  const itemIdMap = new Map<string, string>()
  for (const it of srcItems) {
    itemIdMap.set(it.id, uid(it.type))
  }

  const isTopLevelStack = (st: StackRecord) => !stackIdMap.has(st.parentId)

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
  for (const st of srcStacks) {
    if (isTopLevelStack(st)) expand(st.x, st.y, st.width, st.height)
  }
  for (const it of srcItems) {
    if (stackIdMap.has(containerOf(it))) continue
    expand(it.x, it.y, it.width, it.height)
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
    maxX = 200
    maxY = 200
  }

  let dx = options.dx ?? 0
  let dy = options.dy ?? 0
  if (options.recenter) {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900
    const vp = s.viewport
    const centerWorldX = (vw / 2 - vp.x) / vp.zoom
    const centerWorldY = (vh / 2 - vp.y) / vp.zoom
    dx = centerWorldX - (minX + maxX) / 2
    dy = centerWorldY - (minY + maxY) / 2
  }

  const topLevelOldStackIds = new Set(
    srcStacks.filter(isTopLevelStack).map((st) => st.id),
  )
  const newStackIds: string[] = []

  // Preserve original z within each stack for fan order, then re-block
  const newStacks: StackRecord[] = srcStacks.map((st) => {
    const newId = stackIdMap.get(st.id)!
    const top = isTopLevelStack(st)
    const parentId = top
      ? targetContainer
      : (stackIdMap.get(st.parentId) ?? targetContainer)
    const freeFanRel = st.freeFanRel
      ? st.freeFanRel
          .map((r) => {
            const nid = itemIdMap.get(r.id)
            if (!nid) return null
            return { ...r, id: nid }
          })
          .filter((r): r is NonNullable<typeof r> => r != null)
      : undefined
    const next: StackRecord = {
      ...st,
      id: newId,
      parentId,
      x: top ? st.x + dx : st.x,
      y: top ? st.y + dy : st.y,
      zIndex: st.zIndex,
      viewport: st.viewport ? { ...st.viewport } : undefined,
      ...(freeFanRel && freeFanRel.length > 0 ? { freeFanRel } : {}),
    }
    if (top) newStackIds.push(newId)
    return next
  })

  const newItems: CanvasItem[] = srcItems.map((raw) => {
    const oldId = raw.id
    const src = structuredClone(raw) as CanvasItem
    const oldContainer = containerOf(src)
    src.id = itemIdMap.get(oldId) || uid(src.type)


    if (src.type === 'scribble') {
      src.paths = src.paths.map((p) => ({ ...p, id: uid('path') }))
    }

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
          zIndex: src.zIndex,
        } as CanvasItem,
        stackIdMap.get(oldContainer)!,
      )
    }

    return asPasteFreeItem(
      {
        ...src,
        x: src.x + dx,
        y: src.y + dy,
        zIndex: src.zIndex,
      } as CanvasItem,
      targetContainer,
    )
  })

  // Seed relative z from freeFanRel order so fan order matches the source
  for (const st of newStacks) {
    if (!st.freeFanRel?.length) continue
    let z = 1
    // Assign increasing z by freeFanRel index so fan paint order matches source
    const byId = new Map(newItems.map((i) => [i.id, i]))
    for (const r of st.freeFanRel) {
      const it = byId.get(r.id)
      if (it) it.zIndex = z++
    }
    const listed = new Set(st.freeFanRel.map((r) => r.id))
    const treeIds = collectDescendantStackIds(newStacks, st.id)
    const rest = newItems
      .filter((i) => treeIds.has(containerOf(i)) && !listed.has(i.id))
      .sort((a, b) => a.zIndex - b.zIndex)
    for (const it of rest) it.zIndex = z++
  }

  // Merge into board then allocate contiguous z blocks per top-level stack
  let nextZ = s.nextZ
  let mergedItems = [...s.items, ...newItems]
  let mergedStacks = [...s.stacks, ...newStacks]

  for (const sid of newStackIds) {
    // Surface order: freeFanRel leaf order as item keys when available
    const st = mergedStacks.find((x) => x.id === sid)
    const surfaceOrder: string[] | undefined = st?.freeFanRel?.length
      ? (() => {
          // Build surface order for direct children only
          const directItems = mergedItems.filter(
            (i) => containerOf(i) === sid,
          )
          const directStacks = stacksInContainer(mergedStacks, sid)
          const keys: string[] = []
          const seen = new Set<string>()
          // Prefer freeFanRel order for any direct free items present there
          for (const r of st!.freeFanRel!) {
            if (directItems.some((i) => i.id === r.id) && !seen.has(r.id)) {
              keys.push(`item:${r.id}`)
              seen.add(r.id)
            }
          }
          for (const i of directItems.sort((a, b) => a.zIndex - b.zIndex)) {
            if (!seen.has(i.id)) {
              keys.push(`item:${i.id}`)
              seen.add(i.id)
            }
          }
          for (const cs of directStacks.sort(
            (a, b) => a.zIndex - b.zIndex,
          )) {
            keys.push(`stack:${cs.id}`)
          }
          return keys
        })()
      : undefined

    const { itemZMap, stackZMap, nextZ: nz } = allocateNestedStackTreeZ(
      mergedItems,
      mergedStacks,
      sid,
      nextZ,
      surfaceOrder,
    )
    nextZ = nz
    mergedItems = mergedItems.map((item) =>
      itemZMap.has(item.id)
        ? { ...item, zIndex: itemZMap.get(item.id)! }
        : item,
    )
    mergedStacks = mergedStacks.map((st2) =>
      stackZMap.has(st2.id)
        ? { ...st2, zIndex: stackZMap.get(st2.id)! }
        : st2,
    )
  }

  // Free items not inside pasted stacks: place above everything
  const freeNew = newItems.filter((i) => containerOf(i) === targetContainer)
  for (const it of freeNew) {
    const live = mergedItems.find((m) => m.id === it.id)
    if (live) live.zIndex = nextZ++
  }

  const topLevelItemIds = freeNew.map((i) => i.id)

  set({
    items: mergedItems,
    stacks: mergedStacks,
    nextZ,
    selectedIds: options.select ? topLevelItemIds : s.selectedIds,
    selectedStackIds: options.select ? newStackIds : s.selectedStackIds,
    editingId: null,
    editingStackGroupId: null,
    dirty: true,
  })

  return { itemIds: topLevelItemIds, stackIds: newStackIds }
}

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

  const clipItems = cloneItemsDeep(items.filter((i) => itemIds.has(i.id)))
  const clipStacks = cloneStacksDeep(stacks.filter((s) => stackIds.has(s.id)))

  return {
    mode: 'copy',
    items: clipItems,
    stacks: clipStacks,
    sourceContainerId: currentContainerId,
  }
}

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

export function createSelectionActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, SelectionActionKey> {
  return {

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

      // Full surface reflow: free raise must not leave sibling stacks interleaved
      // (folder of A under fan of B under fan of A).
      const { itemZMap, stackZMap, nextZ } = raiseSelectionZ(
        s.items,
        s.stacks,
        selectedIds,
        additive ? s.selectedStackIds : [],
        s.nextZ,
        {
          promoteFreeId,
          containerId: s.currentContainerId,
        },
      )
      const dirtyZ =
        itemZChanged(s.items, itemZMap) || stackZChanged(s.stacks, stackZMap)

      return {
        selectedIds,
        selectedStackIds: additive ? s.selectedStackIds : [],
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
        // Raise-on-select persists in the file — mark dirty when z actually moves
        ...(dirtyZ ? { dirty: true as const } : {}),
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
        { containerId: s.currentContainerId },
      )
      const dirtyZ =
        itemZChanged(s.items, itemZMap) || stackZChanged(s.stacks, stackZMap)

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
        ...(dirtyZ ? { dirty: true as const } : {}),
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
        { containerId: s.currentContainerId },
      )
      const dirtyZ =
        itemZChanged(s.items, itemZMap) || stackZChanged(s.stacks, stackZMap)
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
        ...(dirtyZ ? { dirty: true as const } : {}),
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

    set((s) => {
      const remaining = s.items.filter((i) => !removeItemIds.has(i.id))
      // pushHistory already ran — history holds pre-delete items with blob srcs
      const keep = blobUrlsStillReachable(remaining, s.history, s.future)
      revokeUnreferencedBlobs(s.items, keep)
      return {
        items: remaining,
        stacks: s.stacks.filter((st) => !removeStackIds.has(st.id)),
        selectedIds: [],
        selectedStackIds: [],
        editingStackGroupId:
          editingStackGroupId && removeStackIds.has(editingStackGroupId)
            ? null
            : s.editingStackGroupId,
        dirty: true,
      }
    })
  },


  hasClipboard: () =>
    !!(
      canvasClipboard &&
      (canvasClipboard.items.length > 0 || canvasClipboard.stacks.length > 0)
    ),


  clearClipboard: () => {
    canvasClipboard = null
  },


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
    set((st) => {
      const remaining = st.items.filter((i) => !removeItemIds.has(i.id))
      const keep = blobUrlsStillReachable(remaining, st.history, st.future)
      revokeUnreferencedBlobs(st.items, keep)
      return {
        items: remaining,
        stacks: st.stacks.filter((rec) => !removeStackIds.has(rec.id)),
        selectedIds: [],
        selectedStackIds: [],
        editingId: null,
        editingStackGroupId:
          editingStackGroupId && removeStackIds.has(editingStackGroupId)
            ? null
            : st.editingStackGroupId,
        dirty: true,
      }
    })
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

    const result = cloneBodiesIntoCanvas(
      get,
      set,
      clip.items,
      clip.stacks,
      {
        recenter: true,
        select: true,
      },
    )
    if (!result) return false

    // After paste, keep payload as copy for multi-paste
    canvasClipboard = { ...clip, mode: 'copy' }
    return true
  },


  duplicateBodies: (itemIds, stackIds) => {
    const s = get()
    if (s.animating) return { itemIds: [], stackIds: [] }
    const idSet = new Set(itemIds)
    const stackSet = new Set(stackIds)
    // Expand to full trees for selected stacks
    const allStackIds = new Set<string>()
    for (const sid of stackSet) {
      for (const id of collectDescendantStackIds(s.stacks, sid)) {
        allStackIds.add(id)
      }
    }
    const clipStacks = s.stacks.filter((st) => allStackIds.has(st.id))
    const clipItems = s.items.filter((it) => {
      if (idSet.has(it.id) && !allStackIds.has(containerOf(it))) return true
      if (allStackIds.has(containerOf(it))) return true
      return false
    })
    if (clipItems.length === 0 && clipStacks.length === 0) {
      return { itemIds: [], stackIds: [] }
    }
    const result = cloneBodiesIntoCanvas(get, set, clipItems, clipStacks, {
      recenter: false,
      select: true,
      // Alt-drag: keep world position; drag will move the clones
      dx: 0,
      dy: 0,
    })
    return result ?? { itemIds: [], stackIds: [] }
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
        { containerId: s.currentContainerId },
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
      // Full surface reflow with selection pinned under other bodies
      const { itemZMap, stackZMap, nextZ } = raiseSelectionZ(
        s.items,
        s.stacks,
        target,
        stackIds,
        s.nextZ,
        { containerId: s.currentContainerId, pinToBack: true },
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


  duplicateItems: (ids) => {
    if (ids.length === 0) return []
    const { items, nextZ } = get()
    const idSet = new Set(ids)
    // Preserve relative z order of sources
    const sources = items
      .filter((i) => idSet.has(i.id))
      .sort((a, b) => a.zIndex - b.zIndex)
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


  getSelectedItems: () => {
    const { items, selectedIds } = get()
    const setIds = new Set(selectedIds)
    return items.filter((i) => setIds.has(i.id))
  },
  }
}
