import type { CanvasItem } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import { uid } from '../../utils/id'
import { computeQuickStack, computeQuickStackBodies, computeRowLayout, computeSmoothLayout, computeTightLayout, stackGroupBounds, STACK_FOLDER_PAD } from '../../utils/layout'
import { allocateStackZBlock, freezeStackSurfaceZ, nestedStackUnitMaxZ } from '../../utils/zOrder'
import { asFreeOnContainer, containerOf, countLeafItemsInStack, createStackRecord, folderBoundsFromFan, freeFanRelFromLocalFan, itemsInContainer, resolveNestedFreeFan, stackDisplayName, stackLabelName, stackPath, stacksInContainer, withViewport } from '../../utils/stacks'
import { type LayoutTarget } from '../../utils/layout'
import { easeOutCubic } from '../actionHelpers'
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'

export type StackActionKey =
  | 'commitStackName'
  | 'getVisibleItems'
  | 'getVisibleStacks'
  | 'getBreadcrumb'
  | 'enterStack'
  | 'navigateToContainer'
  | 'updateStacks'
  | 'moveStacks'
  | 'animateToLayout'
  | 'quickStack'
  | 'mergeIntoStack'
  | 'dissolveSelectedStacks'
  | 'smoothLayout'
  | 'rowLayout'

export function createStackActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, StackActionKey> {
  return {
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
        name: stackLabelName(stack.name),
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


  navigateToContainer: (containerId, options) => {
    const s = get()
    if (containerId === s.currentContainerId) return
    // Silent folds may run while animating is still true at settle end —
    // only block user-driven animated nav when another anim is in flight.
    const wantAnim = options?.animate !== false
    if (wantAnim && s.animating) return

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
     *
     * Multi-level jumps (e.g. C → Home): play **one** animated exit from the
     * current level, then silently fold remaining parents (`animate: false`)
     * so fans are correct without stepwise intermediate animations.
     */
    if (leavingStack) {
      const immediateTarget = leavingStack.parentId
      const needsChaining = containerId !== immediateTarget
      /** After first animated exit, remaining levels fold silently */
      const chainSilent = needsChaining && wantAnim
      const runExitAnim = wantAnim
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
        const stackName = stackLabelName(leavingStack.name)

        const startMap = new Map(
          members.map((m) => [
            m.id,
            { x: m.x, y: m.y, rotation: m.rotation ?? 0 },
          ]),
        )

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

        const leafCountExit = countLeafItemsInStack(
          get().items,
          get().stacks,
          leavingId,
        )

        /** Final gather handoff (same as anim end). Used by silent multi-level fold. */
        const applyExitHandoff = (opts?: {
          keepAnimating?: boolean
          pending?: string | null
          /** Continue peer fade from this value — do NOT jump to 1 (causes flash) */
          peerReveal?: number
        }) => {
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
          const peerAt = opts?.peerReveal ?? 1
          set({
            animating: opts?.keepAnimating ?? false,

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
            currentContainerId: immediateTarget,
            selectedIds: [],
            selectedStackIds: [],
            editingId: null,
            editingStackGroupId: null,
            stackEnterAnim: opts?.keepAnimating
              ? {
                  stackId: leavingId,
                  mode: 'exit' as const,
                  start: fullScreen,
                  end: folderScreen,
                  t: 1,
                  settle: 0,
                  peerReveal: peerAt,
                  nestedChromeOpacity: 0,
                  name: stackName,
                  memberCount: leafCountExit,
                  targetContainerId: chainSilent
                    ? containerId
                    : immediateTarget,
                }
              : null,
            viewport: continuousVp,
            ...(immediateTarget === ROOT_CONTAINER_ID
              ? { homeViewport: continuousVp }
              : {}),
            pendingNavigation: opts?.pending ?? null,
          })
        }

        // Silent multi-level tail (or full silent jump): handoff only, no RAF
        if (!runExitAnim) {
          applyExitHandoff({
            keepAnimating: false,
            pending: null,
            peerReveal: 1,
          })
          if (needsChaining) {
            get().navigateToContainer(containerId, { animate: false })
          }
          return
        }

        const t0 = performance.now()
        /** Parent peers: start ~200ms after exit begins, ease over ~500ms */
        const peerRevealAt = (now: number) => {
          const u = Math.max(0, Math.min(1, (now - t0 - 200) / 500))
          return u * u * (3 - 2 * u)
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
            // Path: final multi-level target if chaining, else immediate parent
            targetContainerId: chainSilent ? containerId : immediateTarget,
          },
        })

        const dur = 560
        const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
        const folderPhase = (t: number) => easeOut(t)
        // Nested folder chrome dissolves during gather (slightly leads the end)
        const nestedChromeAt = (eFolder: number) =>
          Math.max(0, 1 - Math.min(1, eFolder / 0.85))

        const finishAfterExitAnim = () => {
          const pending = chainSilent ? containerId : null
          // Keep peer fade continuous across handoff (no opacity jump / flash)
          const peerNow = peerRevealAt(performance.now())
          applyExitHandoff({
            keepAnimating: true,
            pending: null,
            peerReveal: peerNow,
          })
          // Settle overlay + finish peer fade, then silent-fold remaining parents
          const settleT0 = performance.now()
          const settleDur = 160
          const settleTick = (now: number) => {
            const st = Math.min(1, (now - settleT0) / settleDur)
            const e = st * st * (3 - 2 * st)
            const anim = get().stackEnterAnim
            const peer = peerRevealAt(now)
            if (!anim || anim.mode !== 'exit') {
              set({
                animating: false,
                stackEnterAnim: null,
                pendingNavigation: null,
              })
              if (pending) {
                queueMicrotask(() =>
                  get().navigateToContainer(pending, { animate: false }),
                )
              }
              return
            }
            set({
              stackEnterAnim: {
                ...anim,
                t: 1,
                settle: e,
                peerReveal: peer,
                targetContainerId: chainSilent ? containerId : immediateTarget,
              },
            })
            if (st < 1 || peer < 0.999) {
              requestAnimationFrame(settleTick)
            } else {
              set({
                animating: false,
                stackEnterAnim: null,
                pendingNavigation: null,
              })
              if (pending) {
                queueMicrotask(() =>
                  get().navigateToContainer(pending, { animate: false }),
                )
              }
            }
          }
          requestAnimationFrame(settleTick)
        }

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
              targetContainerId: chainSilent ? containerId : immediateTarget,
            },
          }))

          if (raw < 1) {
            requestAnimationFrame(tick)
            return
          }

          finishAfterExitAnim()
        }
        requestAnimationFrame(tick)
        return
      }

      // Empty stack — exit immediately without animation
      const emptyTargetVp =
        immediateTarget === ROOT_CONTAINER_ID
          ? { ...get().homeViewport }
          : (() => {
              const parentStack = get().stacks.find(
                (st) => st.id === immediateTarget,
              )
              return parentStack?.viewport
                ? { ...parentStack.viewport }
                : { ...get().viewport }
            })()
      set({
        currentContainerId: immediateTarget,
        selectedIds: [],
        selectedStackIds: [],
        editingId: null,
        editingStackGroupId: null,
        stackEnterAnim: null,
        animating: false,
        viewport: emptyTargetVp,
        pendingNavigation: null,
      })
      if (needsChaining) {
        // Silent fold remaining levels (one shot, no stepwise anim)
        get().navigateToContainer(containerId, { animate: false })
      }
      return
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
  }
}
