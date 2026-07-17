import type { CanvasItem, StackRecord } from '../../types/canvas'
import { expandStackSelection } from '../../utils/layout'
import { containerOf } from '../../utils/stacks'

/** Free items + stacks currently selected on the active canvas, for joint drag. */
export function captureJointMoveSelection(store: {
  items: CanvasItem[]
  stacks: StackRecord[]
  selectedIds: string[]
  selectedStackIds: string[]
  currentContainerId: string
}): {
  ids: string[]
  origins: Record<string, { x: number; y: number }>
  stackIds: string[]
  stackOrigins: Record<string, { x: number; y: number }>
} {
  const ids = expandStackSelection(store.selectedIds, store.items).filter(
    (id) => {
      const it = store.items.find((i) => i.id === id)
      if (!it || it.stacked) return false
      return containerOf(it) === store.currentContainerId
    },
  )
  const origins: Record<string, { x: number; y: number }> = {}
  for (const id of ids) {
    const it = store.items.find((i) => i.id === id)
    if (it) origins[id] = { x: it.x, y: it.y }
  }
  const stackIds = store.selectedStackIds.filter((sid) => {
    const st = store.stacks.find((s) => s.id === sid)
    return !!st && st.parentId === store.currentContainerId
  })
  const stackOrigins: Record<string, { x: number; y: number }> = {}
  for (const sid of stackIds) {
    const st = store.stacks.find((s) => s.id === sid)
    if (st) stackOrigins[sid] = { x: st.x, y: st.y }
  }
  return { ids, origins, stackIds, stackOrigins }
}
