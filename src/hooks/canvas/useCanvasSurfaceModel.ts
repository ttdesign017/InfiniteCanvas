import { useMemo } from 'react'
import type { CanvasItem, EmbedItem, StackRecord } from '../../types/canvas'
import { computeSelectionBounds } from '../../utils/selectionBounds'
import {
  collapsedStackFanCards,
  collapsedStackFolderBounds,
  containerOf,
  itemsInContainer,
} from '../../utils/stacks'
import { stackGroupBounds } from '../../utils/layout'

export type StackFolderView = {
  gid: string
  members: CanvasItem[]
  bounds: { x: number; y: number; width: number; height: number }
  selected: boolean
  dropTarget: boolean
  z: number
  name: string
  record: StackRecord | null
  proxy: CanvasItem | undefined
  isRecord: boolean
}

/**
 * Derived lists for rendering the current canvas surface:
 * free items, embeds, multi-select bbox, collapsed stack folders + fan cards.
 */
export function useCanvasSurfaceModel(input: {
  items: CanvasItem[]
  stacks: StackRecord[]
  currentContainerId: string
  selectedIds: string[]
  selectedStackIds: string[]
  stackDropTargetId: string | null
  tool: string
  spaceHeld: boolean
  cHeld: boolean
}) {
  const {
    items,
    stacks,
    currentContainerId,
    selectedIds,
    selectedStackIds,
    stackDropTargetId,
    tool,
    spaceHeld,
    cHeld,
  } = input

  const visibleItems = useMemo(
    () => itemsInContainer(items, currentContainerId),
    [items, currentContainerId],
  )
  const visibleStacks = useMemo(
    () => stacks.filter((s) => s.parentId === currentContainerId),
    [stacks, currentContainerId],
  )

  const sortedItems = useMemo(
    () => [...visibleItems].sort((a, b) => a.zIndex - b.zIndex),
    [visibleItems],
  )
  const sortedNonEmbeds = useMemo(
    () => sortedItems.filter((i) => i.type !== 'embed'),
    [sortedItems],
  )
  const allEmbedItems = useMemo(
    () =>
      items
        .filter((i): i is EmbedItem => i.type === 'embed')
        .sort((a, b) => a.zIndex - b.zIndex),
    [items],
  )

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedStackSet = useMemo(
    () => new Set(selectedStackIds),
    [selectedStackIds],
  )

  const freeSelectedCount = useMemo(() => {
    return items.filter(
      (i) =>
        selectedIds.includes(i.id) &&
        !i.stacked &&
        containerOf(i) === currentContainerId,
    ).length
  }, [items, selectedIds, currentContainerId])

  const selectedStackCount = useMemo(() => {
    return stacks.filter(
      (s) =>
        selectedStackIds.includes(s.id) && s.parentId === currentContainerId,
    ).length
  }, [stacks, selectedStackIds, currentContainerId])

  const multiBodyCount = freeSelectedCount + selectedStackCount
  const isGroupSelect = multiBodyCount >= 2

  const groupBounds = useMemo(() => {
    if (!isGroupSelect) return null
    return computeSelectionBounds(
      items,
      stacks,
      selectedIds,
      selectedStackIds,
      currentContainerId,
    )
  }, [
    isGroupSelect,
    items,
    stacks,
    selectedIds,
    selectedStackIds,
    currentContainerId,
  ])

  const effectiveTool = spaceHeld ? 'pan' : cHeld ? 'crop' : tool

  const stackFolders = useMemo((): StackFolderView[] => {
    const fromRecords = visibleStacks.map((st) => {
      const members = items.filter((i) => containerOf(i) === st.id)
      const bounds = collapsedStackFolderBounds(st, items, stacks)
      return {
        gid: st.id,
        members,
        bounds,
        selected: selectedStackSet.has(st.id),
        dropTarget: stackDropTargetId === st.id,
        z: st.zIndex,
        name: st.name,
        record: st as StackRecord,
        proxy: members[0] as CanvasItem | undefined,
        isRecord: true as const,
      }
    })

    const groups = new Map<string, CanvasItem[]>()
    for (const it of visibleItems) {
      if (!it.stackGroupId || !it.stacked) continue
      if (it.stackGroupId === currentContainerId) continue
      if (fromRecords.some((r) => r.gid === it.stackGroupId)) continue
      if (stacks.some((s) => s.id === it.stackGroupId)) continue
      const list = groups.get(it.stackGroupId) || []
      list.push(it)
      groups.set(it.stackGroupId, list)
    }
    const legacy = [...groups.entries()]
      .map(([gid, members]) => {
        const b = stackGroupBounds(members)
        if (!b) return null
        return {
          gid,
          members,
          bounds: b,
          selected: members.some((m) => selectedSet.has(m.id)),
          dropTarget: stackDropTargetId === gid,
          z: Math.min(...members.map((m) => m.zIndex)) - 1,
          name: members.find((m) => m.stackName)?.stackName || '',
          record: null as StackRecord | null,
          proxy: members[0],
          isRecord: false as const,
        }
      })
      .filter(Boolean) as StackFolderView[]

    return [...fromRecords, ...legacy]
  }, [
    visibleStacks,
    visibleItems,
    items,
    stacks,
    currentContainerId,
    selectedSet,
    selectedStackSet,
    stackDropTargetId,
  ])

  const stackPreviewItems = useMemo(() => {
    const out: CanvasItem[] = []
    for (const st of visibleStacks) {
      for (const c of collapsedStackFanCards(st, items, stacks)) {
        const m = items.find((i) => i.id === c.id)
        if (!m || m.type === 'embed') continue
        out.push({
          ...m,
          x: c.x,
          y: c.y,
          rotation: c.rotation,
          stacked: true,
          stackGroupId: st.id,
        })
      }
    }
    return out.sort((a, b) => a.zIndex - b.zIndex)
  }, [visibleStacks, items, stacks])

  return {
    visibleItems,
    visibleStacks,
    sortedItems,
    sortedNonEmbeds,
    allEmbedItems,
    selectedSet,
    selectedStackSet,
    freeSelectedCount,
    selectedStackCount,
    multiBodyCount,
    isGroupSelect,
    groupBounds,
    effectiveTool,
    stackFolders,
    stackPreviewItems,
  }
}
