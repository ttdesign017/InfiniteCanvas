import { useMemo } from 'react'
import type { CanvasItem, StackRecord } from '../../types/canvas'
import type { StackEnterAnim } from '../../store/types'
import { useStackAnimProgress } from '../../utils/stackAnimProgress'
import {
  collapsedStackFanCards,
  collapsedStackFolderBounds,
  containerOf,
} from '../../utils/stacks'
import { peerStackGhostOwnsLayer } from '../../utils/stackNavigationAnimation'
import { stackCountPaintZ, stackFolderPaintZ } from '../../utils/zOrder'

/**
 * Enter/exit parent-peer ghost layers (items + sibling stacks) for stack nav morph.
 */
export function useStackNavGhosts(input: {
  items: CanvasItem[]
  stacks: StackRecord[]
  currentContainerId: string
  stackEnterAnim: StackEnterAnim | null
}) {
  const { items, stacks, currentContainerId, stackEnterAnim } = input
  // Per-frame peerReveal lives outside the main store (see stackAnimProgress)
  const animProgress = useStackAnimProgress()

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

  const peerOpacity =
    isExitAnim || isEnterAnim
      ? Math.max(
          0,
          Math.min(1, animProgress.peerReveal ?? (isEnterAnim ? 1 : 0)),
        )
      : 1
  const exitPeerOpacity = isExitAnim ? peerOpacity : 1
  const enterPeerOpacity = isEnterAnim ? peerOpacity : 1
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
  const navPeerOpacity = isEnterAnim
    ? enterPeerOpacity
    : isExitAnim
      ? exitPeerOpacity
      : 1

  /** Focus stack center in ghost-local space (stack top-left is 0,0). */
  const peerScatterOriginLocal =
    animStackRec != null
      ? {
          x: animStackRec.width / 2,
          y: animStackRec.height / 2,
        }
      : null

  /** Focus stack center in parent world space (for real layer after exit handoff). */
  const peerScatterOriginWorld =
    animStackRec != null
      ? {
          x: animStackRec.x + animStackRec.width / 2,
          y: animStackRec.y + animStackRec.height / 2,
        }
      : null

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
    exitPeerOpacity,
    enterPeerOpacity,
    exitAfterHandoff,
    parentPeerGhostItems,
    parentPeerGhostStacks,
    parentPeerGhostStackIds,
    exitParentPeerStackIds,
    navPeerOpacity,
    peerScatterOriginLocal,
    peerScatterOriginWorld,
  }
}
