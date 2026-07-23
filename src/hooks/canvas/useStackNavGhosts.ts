import { useMemo } from 'react'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import type { StackEnterAnim } from '../../store/types'
import {
  collapsedStackFanCards,
  collapsedStackFolderBounds,
  containerOf,
} from '../../utils/stacks'
import { peerStackGhostOwnsLayer } from '../../utils/stackNavigationAnimation'
import { stackCountPaintZ, stackFolderPaintZ } from '../../utils/zOrder'
import { rectCenter } from '../../utils/peerScatter'

/**
 * Enter/exit parent-peer ghost layers (items + sibling stacks) for stack nav morph.
 *
 * Per-frame peerReveal / settle / t are NOT subscribed here — that would re-run
 * the whole canvas controller every RAF. Opacity is applied in the paint layer
 * via `useStackAnimProgress()`.
 */
export function useStackNavGhosts(input: {
  items: CanvasItem[]
  stacks: StackRecord[]
  currentContainerId: string
  stackEnterAnim: StackEnterAnim | null
}) {
  const { items, stacks, currentContainerId, stackEnterAnim } = input

  const isEnterAnim = stackEnterAnim?.mode === 'enter'
  const isExitAnim = stackEnterAnim?.mode === 'exit'
  const animStackId = stackEnterAnim?.stackId ?? null
  const animStackRec = animStackId
    ? stacks.find((s) => s.id === animStackId)
    : null
  const animParentId = animStackRec?.parentId ?? null
  const exitingStackId = isExitAnim ? animStackId : null
  const exitingStackRec = isExitAnim ? animStackRec : null
  const exitParentId = isExitAnim ? animParentId : null

  const exitGhostParent =
    isExitAnim &&
    exitingStackId != null &&
    currentContainerId === exitingStackId &&
    exitParentId != null &&
    exitingStackRec != null
  const enterGhostParent =
    isEnterAnim &&
    animStackId != null &&
    currentContainerId === animStackId &&
    animParentId != null &&
    animStackRec != null

  const exitAfterHandoff =
    isExitAnim &&
    exitingStackId != null &&
    currentContainerId !== exitingStackId

  const parentPeerGhostItems = useMemo(() => {
    const ghost = enterGhostParent || exitGhostParent
    const rec = enterGhostParent ? animStackRec : exitingStackRec
    const parentId = enterGhostParent ? animParentId : exitParentId
    if (!ghost || !rec || !parentId) return []
    const ox = rec.x
    const oy = rec.y
    return items
      .filter((i) => containerOf(i) === parentId && i.type !== 'embed')
      .map((i) => ({
        ...i,
        x: i.x - ox,
        y: i.y - oy,
      }))
  }, [
    enterGhostParent,
    exitGhostParent,
    animStackRec,
    exitingStackRec,
    animParentId,
    exitParentId,
    items,
  ])

  const parentPeerStackSnapshots = useMemo(() => {
    if (
      (!isEnterAnim && !isExitAnim) ||
      !animStackRec ||
      !animParentId ||
      !animStackId
    )
      return []
    return stacks
      .filter((s) => s.parentId === animParentId && s.id !== animStackId)
      .map((stack) => {
        const worldBounds = collapsedStackFolderBounds(stack, items, stacks)
        const fanCards = collapsedStackFanCards(stack, items, stacks)
        const folderZ = stackFolderPaintZ(stack, items, stacks)
        const countZ = stackCountPaintZ(stack, items, stacks)
        return {
          stack,
          bounds: worldBounds,
          fanItems: fanCards
            .map((c) => {
              const m = items.find((i) => i.id === c.id)
              if (!m || m.type === 'embed') return null
              return {
                ...m,
                x: c.x,
                y: c.y,
                rotation: c.rotation,
                stacked: true,
                stackGroupId: stack.id,
              } as CanvasItem
            })
            .filter(Boolean) as CanvasItem[],
          count: fanCards.length,
          folderZ,
          countZ,
        }
      })
    // Snapshot at animation start — sibling geometry is nav-locked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnterAnim, isExitAnim, animParentId, animStackId])

  const parentPeerGhostStacks = useMemo(() => {
    if (
      !animStackRec ||
      !peerStackGhostOwnsLayer(
        stackEnterAnim?.mode,
        animStackId,
        currentContainerId,
      )
    )
      return []
    const ox = animStackRec.x
    const oy = animStackRec.y
    return parentPeerStackSnapshots.map((peer) => ({
      ...peer,
      bounds: {
        ...peer.bounds,
        x: peer.bounds.x - ox,
        y: peer.bounds.y - oy,
      },
      fanItems: peer.fanItems.map((item) => ({
        ...item,
        x: item.x - ox,
        y: item.y - oy,
      })),
    }))
  }, [
    animStackRec,
    animStackId,
    currentContainerId,
    parentPeerStackSnapshots,
    stackEnterAnim?.mode,
  ])

  const parentPeerGhostStackIds = useMemo(
    () => new Set(parentPeerGhostStacks.map((peer) => peer.stack.id)),
    [parentPeerGhostStacks],
  )
  const exitParentPeerStackIds = parentPeerGhostStackIds

  /**
   * Focus scatter origin = visual folder center (collapsed hull ∪ stored shell),
   * frozen for the duration of the nav anim so peer rays stay stable.
   * Ghost-local space: stack record top-left is (0,0).
   */
  const peerScatterOrigins = useMemo(() => {
    if (!animStackRec || (!isEnterAnim && !isExitAnim)) {
      return { local: null as { x: number; y: number } | null, world: null as { x: number; y: number } | null }
    }
    const bounds = collapsedStackFolderBounds(animStackRec, items, stacks)
    const world = rectCenter(bounds)
    // continuous / ghost local: parent world − stack record origin
    const local = {
      x: world.x - animStackRec.x,
      y: world.y - animStackRec.y,
    }
    return { local, world }
    // Snapshot once per enter/exit of a given stack — do not track live fan drift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnterAnim, isExitAnim, animStackId])

  const peerScatterOriginLocal = peerScatterOrigins.local
  const peerScatterOriginWorld = peerScatterOrigins.world

  return {
    isEnterAnim,
    isExitAnim,
    animStackId,
    animStackRec,
    animParentId,
    exitingStackId,
    exitingStackRec,
    exitParentId,
    exitGhostParent,
    enterGhostParent,
    exitAfterHandoff,
    parentPeerGhostItems,
    parentPeerGhostStacks,
    parentPeerGhostStackIds,
    exitParentPeerStackIds,
    peerScatterOriginLocal,
    peerScatterOriginWorld,
  }
}
