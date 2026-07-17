import { ROOT_CONTAINER_ID } from '../../types/canvas'
import { STACK_FOLDER_PAD, type LayoutTarget } from '../../utils/layout'
import {
  containerOf,
  countLeafItemsInStack,
  itemsInContainer,
  resolveNestedFreeFan,
  stackLabelName,
  stacksInContainer,
  withViewport,
} from '../../utils/stacks'
import type { CanvasState, GetState, SetState } from '../canvasStoreTypes'
export type StackEnterActionKey = 'enterStack'

export function createStackEnterActions(
  set: SetState,
  get: GetState,
): Pick<CanvasState, StackEnterActionKey> {
  return {
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
        // Frameless window: surface origin 闂?(0,0)
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
    // Start from fan poses: parent absolute 闂?local (folder top-left origin)
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
     * - Pile stackPreview is A-local *gather*; animate unit gather 闂?free
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
      // Do NOT prefer stackPreview here 闂?after exit-A it is gather, not free
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

    // Parallel: cards fan闂佹剚鍋呮慨涔篹e + nested B gather闂佹剚鍋呮慨涔篹e + viewport zoom-in
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
  }
}