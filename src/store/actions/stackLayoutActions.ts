import type { CanvasItem } from '../../types/canvas'
import { uid } from '../../utils/id'
import {
  computeQuickStack,
  computeRowLayout,
  computeSmoothLayout,
  computeTightLayout,
  fanCardRotation,
  stackGroupBounds,
  STACK_FOLDER_PAD,
} from '../../utils/layout'
import { allocateStackZBlock, reflowContainerSurfaceZ } from '../../utils/zOrder'
import {
  asFreeOnContainer,
  containerOf,
  createStackRecord,
  itemsInContainer,
} from '../../utils/stacks'
import { centerOriginPoseToBottomLeftOrigin } from '../../utils/geometry'
import { easeOutCubic } from '../actionHelpers'
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'
export type StackLayoutActionKey =
  | 'updateStacks'
  | 'moveStacks'
  | 'animateToLayout'
  | 'quickStack'
  | 'mergeIntoStack'
  | 'dissolveSelectedStacks'
  | 'smoothLayout'
  | 'rowLayout'

export function createStackLayoutActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, StackLayoutActionKey> {
  return {
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
      // Fan previews live in parent world space 鈥?move with the folder
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
    // When stacking, lock z-order to match pre-stack order (low 鈫?bottom, high 鈫?top)
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
        // Snap exact end poses before handoff (avoids last-frame float drift)
        if (!options?.unstack && !options?.nestInto) {
          set((s) => ({
            items: s.items.map((item) => {
              const target = targetMap.get(item.id)
              if (!target) return item
              const endRot =
                target.rotation !== undefined
                  ? target.rotation
                  : (item.rotation ?? 0)
              return {
                ...item,
                x: target.x,
                y: target.y,
                rotation: endRot,
                ...(target.width !== undefined ? { width: target.width } : {}),
                ...(target.height !== undefined
                  ? { height: target.height }
                  : {}),
              }
            }),
          }))
        }
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
          // Fan anim done on parent 鈫?reparent into enterable stack.
          // Parent keeps fan poses in stackPreview; inner canvas uses free layout.
          // CRITICAL: do NOT leave stacked/stackGroupId on members 鈥?that would
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
          // Contiguous z for the new stack unit among siblings on parent
          const afterNest = get()
          const healed = reflowContainerSurfaceZ(
            afterNest.items,
            afterNest.stacks,
            parentId,
            { frontStackIds: [groupId] },
          )
          set({
            nextZ: Math.max(afterNest.nextZ, healed.nextZ),
            items: afterNest.items.map((item) =>
              healed.itemZMap.has(item.id)
                ? { ...item, zIndex: healed.itemZMap.get(item.id)! }
                : item,
            ),
            stacks: afterNest.stacks.map((st) =>
              healed.stackZMap.has(st.id)
                ? { ...st, zIndex: healed.stackZMap.get(st.id)! }
                : st,
            ),
          })
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
      // Keep ≤300ms — same budget as enterable-stack drop fly-in
      get().animateToLayout(computeQuickStack(ordered), 300, {
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
      // Full-id hash (same as quick-stack fan) — not first char of id
      const rot = fanCardRotation(item.id, existing.length + fanI)
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

    // Fly-in must use the same transform-origin as stack fan cards
    // (`bottom left`). Free cards use `center`; switching only at handoff
    // causes a visible snap when rotation is non-zero.
    // Raise z + convert pose + mark stacked for origin, expand folder, then animate.
    set((s) => ({
      dirty: true,
      nextZ: z,
      items: s.items.map((item) => {
        const p = patches.get(item.id)
        if (!p) return item
        const bl = centerOriginPoseToBottomLeftOrigin(item)
        return {
          ...item,
          x: bl.x,
          y: bl.y,
          rotation: bl.rotation,
          zIndex: p.zIndex,
          // Visual-only: still free on parent container, but paint like a fan card
          stacked: true,
          stackGroupId: groupId,
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

    // Fly from drop pose → fan preview (ease-out cubic, hard cap 300ms)
    const MERGE_FLY_MS = 280
    const flyTargets = [...patches.values()].map((p) => ({
      id: p.item.id,
      x: p.preview.x,
      y: p.preview.y,
      rotation: p.preview.rotation,
    }))
    const flyTargetById = new Map(flyTargets.map((t) => [t.id, t]))

    const finalizeMerge = () => {
      set((s) => ({
        dirty: true,
        items: s.items.map((item) => {
          const p = patches.get(item.id)
          if (!p) return item
          // Prefer exact fly target so handoff cannot drift from the last RAF
          const end = flyTargetById.get(item.id) ?? p.preview
          return {
            ...asFreeOnContainer(item, groupId, p.inner, {
              x: end.x,
              y: end.y,
              rotation: end.rotation,
            }),
            zIndex: p.zIndex,
          }
        }),
      }))
      const afterMerge = get()
      const parentId = afterMerge.stacks.find((s) => s.id === groupId)?.parentId
      if (parentId) {
        const healed = reflowContainerSurfaceZ(
          afterMerge.items,
          afterMerge.stacks,
          parentId,
          { frontStackIds: [groupId] },
        )
        set({
          nextZ: Math.max(afterMerge.nextZ, healed.nextZ),
          items: afterMerge.items.map((item) =>
            healed.itemZMap.has(item.id)
              ? { ...item, zIndex: healed.itemZMap.get(item.id)! }
              : item,
          ),
          stacks: afterMerge.stacks.map((st) =>
            healed.stackZMap.has(st.id)
              ? { ...st, zIndex: healed.stackZMap.get(st.id)! }
              : st,
          ),
        })
      }
    }

    get().animateToLayout(flyTargets, MERGE_FLY_MS, {
      skipHistory: true,
      onComplete: finalizeMerge,
    })
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
      // Nested StackRecord dissolve 鈫?free items at fan (preview) pose
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

    // Smooth fan 鈫?tight shelf (classic Alt+G motion)
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
  }
}
