/**
 * Stack exit navigation session — animated gather + handoff + multi-level fold.
 * Called from navigateToContainer when leaving a nested stack.
 */
import type { CanvasItem, StackRecord } from '../../types/canvas'
import { ROOT_CONTAINER_ID } from '../../types/canvas'
import {
  computeQuickStackBodies,
  stackGroupBounds,
  STACK_FOLDER_PAD,
} from '../../utils/layout'
import {
  freezeStackSurfaceZ,
  nestedStackUnitMaxZ,
  reflowContainerSurfaceZ,
} from '../../utils/zOrder'
import {
  containerOf,
  countLeafItemsInStack,
  folderBoundsFromFan,
  freeFanRelFromLocalFan,
  itemsInContainer,
  participatesInStackFan,
  resolveNestedFreeFan,
  stackLabelName,
  stacksInContainer,
} from '../../utils/stacks'
import {
  resetStackAnimProgress,
  seedStackAnimProgress,
  setStackAnimProgress,
} from '../../utils/stackAnimProgress'
import { ensureStackFanComposite } from '../../utils/stackFanComposite'
import type { GetState, SetState } from '../canvasStoreTypes'

export function runStackExitNavigation(
  set: SetState,
  get: GetState,
  args: {
    leavingStack: StackRecord
    /** Final breadcrumb target (may be grandparent / home) */
    containerId: string
    wantAnim: boolean
  },
): void {
  const { leavingStack, containerId, wantAnim } = args
  const s = get()
  const leavingId = leavingStack.id
    const immediateTarget = leavingStack.parentId
    const needsChaining = containerId !== immediateTarget
    /** After first animated exit, remaining levels fold silently */
    const chainSilent = needsChaining && wantAnim
    const runExitAnim = wantAnim
    const members = itemsInContainer(s.items, leavingId)
    // Scribbles stay free-local only — never gather into fan / folder geometry
    const fanMembers = members.filter(participatesInStackFan)
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
      // re-expanded by fan recompute 闂?that grew B's frame on each exit).
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
        // Free layout while inside A 闂?include deep leaves (C under B)
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
          // Rigid free fan (all leaves) 闂?never recompute compact fan on parent exit
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

      const itemBodies = fanMembers.map((m) => ({
        id: m.id,
        x: m.x,
        y: m.y,
        width: m.width,
        height: m.height,
        zIndex: m.zIndex,
      }))
      // Unit z = visual top of nested fan (max leaf z), not folder slot alone 闂?
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
       * re-pin after 闂?previews alone can sit at origin and eat left/top pad.
       */
      type Pose2 = { x: number; y: number; rotation: number }
      /*
       * When nested stack units are present, ALWAYS use the mixed fan for free
       * items + units together. Preferring free-item-only stackPreview would
       * place free cards in one formation and B in another 闂?gather misalignment.
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
        const fanFromPreview = fanMembers.map((m) => {
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
          fanMembers.length > 0 &&
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

      // All leaf cards (for pin bounds) 闂?must include nested B members
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

      // Nested leaf id 闂?unit for frame-0 seating
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

      /**
       * Build the post-handoff stack+items snapshot used for fan cards, and
       * rasterize the composite *before* switching containers so CollapsedStackFans
       * mounts onto a ready bitmap (no empty frame / live remount flash).
       */
      const buildExitFanCompositeInput = () => {
        const live = get()
        const freeFanRel = freeFanRelFromLocalFan(
          fanMembers
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

        const items = live.items.map((item) => {
          if (memberIds.has(item.id)) {
            const free = freeMap.get(item.id)
            const f = fanMap.get(item.id)
            if (!participatesInStackFan(item) || !f) {
              return {
                ...item,
                stacked: false,
                stackGroupId: undefined,
                x: free?.x ?? item.x,
                y: free?.y ?? item.y,
                rotation: free?.rotation ?? item.rotation ?? 0,
                stackPreview: undefined,
              } as CanvasItem
            }
            return {
              ...item,
              stacked: false,
              stackGroupId: undefined,
              x: free?.x ?? item.x,
              y: free?.y ?? item.y,
              rotation: free?.rotation ?? 0,
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
          return item
        })

        const stacks = live.stacks.map((st) => {
          if (st.id === leavingId) {
            return {
              ...st,
              x: parentStackX,
              y: parentStackY,
              width: finalAW,
              height: finalAH,
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
              ...(persistRel ? { freeFanRel: persistRel } : {}),
            }
          }
          return st
        })

        const stack = stacks.find((s) => s.id === leavingId)!
        return { stack, items, stacks }
      }

      let exitCompositePrewarm: Promise<unknown> | null = null
      const prewarmExitFanComposite = () => {
        if (exitCompositePrewarm) return exitCompositePrewarm
        try {
          const prep = buildExitFanCompositeInput()
          exitCompositePrewarm = ensureStackFanComposite(
            prep.stack,
            prep.items,
            prep.stacks,
          ).catch(() => null)
        } catch {
          exitCompositePrewarm = Promise.resolve(null)
        }
        return exitCompositePrewarm
      }

      /** Final gather handoff (same as anim end). Used by silent multi-level fold. */
      const applyExitHandoff = (opts?: {
        keepAnimating?: boolean
        pending?: string | null
        /** Continue peer fade from this value 闂?do NOT jump to 1 (causes flash) */
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
        // First write freeze + fan poses, then reflow parent surface so this
        // stack unit cannot interleave with sibling stacks / free items.
        set({
          animating: opts?.keepAnimating ?? false,

          nextZ: Math.max(liveForZ.nextZ, frozenZ.nextZ),
          items: get().items.map((item) => {
            const z = frozenZ.itemZMap.get(item.id)
            if (memberIds.has(item.id)) {
              const free = freeMap.get(item.id)
              const f = fanMap.get(item.id)
              // Scribbles: restore free pose only — never parent fan preview
              if (!participatesInStackFan(item) || !f) {
                return {
                  ...item,
                  stacked: false,
                  stackGroupId: undefined,
                  x: free?.x ?? item.x,
                  y: free?.y ?? item.y,
                  rotation: free?.rotation ?? item.rotation ?? 0,
                  zIndex: z ?? item.zIndex,
                  stackPreview: undefined,
                } as CanvasItem
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
                fanMembers
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
        if (opts?.keepAnimating) {
          seedStackAnimProgress({
            t: 1,
            settle: 0,
            peerReveal: peerAt,
            nestedChromeOpacity: 0,
          })
        } else {
          resetStackAnimProgress()
        }
        // Heal sibling interleaving on the parent canvas (folder|fan atomic)
        const after = get()
        const parentSurface = after.stacks.find((s) => s.id === leavingId)
          ?.parentId
        if (parentSurface) {
          const healed = reflowContainerSurfaceZ(
            after.items,
            after.stacks,
            parentSurface,
          )
          set({
            nextZ: Math.max(after.nextZ, healed.nextZ),
            items: after.items.map((item) =>
              healed.itemZMap.has(item.id)
                ? { ...item, zIndex: healed.itemZMap.get(item.id)! }
                : item,
            ),
            stacks: after.stacks.map((st) =>
              healed.stackZMap.has(st.id)
                ? { ...st, zIndex: healed.stackZMap.get(st.id)! }
                : st,
            ),
          })
        }
      }

      // Silent multi-level tail (or full silent jump): handoff only, no RAF.
      // Do not await prewarm — callers (and tests) expect sync container switch.
      if (!runExitAnim) {
        void prewarmExitFanComposite()
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
            // Scribbles do not gather — stay free and fade out in the UI
            if (!participatesInStackFan(item)) return item
            return {
              ...item,
              stacked: true,
              stackGroupId: leavingId,
            } as CanvasItem
          }
          // Seat nested B leaves under unit start (rigid fan) 闂?no first-frame pop
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
      seedStackAnimProgress({
        t: 0,
        settle: 0,
        peerReveal: 0,
        nestedChromeOpacity: 1,
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
        // Hold the last gather frame until the fan bitmap is ready, then switch
        // containers so the exiting stack never paints an empty fan.
        void prewarmExitFanComposite().finally(() => {
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
              resetStackAnimProgress()
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
            // Settle/peer only — avoid rewriting stackEnterAnim (and React) every frame
            setStackAnimProgress({
              t: 1,
              settle: e,
              peerReveal: peer,
              nestedChromeOpacity: 0,
            })
            if (st < 1 || peer < 0.999) {
              requestAnimationFrame(settleTick)
            } else {
              resetStackAnimProgress()
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
        })
      }

      const tick = (now: number) => {
        if (get().currentContainerId !== leavingId) {
          resetStackAnimProgress()
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

        // Layout + viewport still need store updates; morph scalars use progress bus
        setStackAnimProgress({
          t: eFolder,
          settle: 0,
          peerReveal,
          nestedChromeOpacity,
        })
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
        }))

        // Start rasterizing the final fan while gather finishes (covers handoff)
        if (raw >= 0.72) {
          void prewarmExitFanComposite()
        }

        if (raw < 1) {
          requestAnimationFrame(tick)
          return
        }

        finishAfterExitAnim()
      }
      requestAnimationFrame(tick)
      return
    }

    // Empty stack 闂?exit immediately without animation
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
    resetStackAnimProgress()
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
}
