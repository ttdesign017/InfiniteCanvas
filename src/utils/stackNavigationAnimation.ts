export type StackNavigationMode = 'enter' | 'exit' | null | undefined

/** Peer-stack ghosts only own the layer before the container handoff. */
export function peerStackGhostOwnsLayer(
  mode: StackNavigationMode,
  animationStackId: string | null,
  currentContainerId: string,
): boolean {
  return (
    (mode === 'enter' || mode === 'exit') &&
    animationStackId != null &&
    currentContainerId === animationStackId
  )
}

/** Continue the ghost reveal on real sibling fan cards after exit handoff. */
export function exitPeerStackPreviewOpacity(
  afterHandoff: boolean,
  exitingStackId: string | null,
  previewStackId: string | undefined,
  peerOpacity: number,
): number {
  if (
    !afterHandoff ||
    previewStackId == null ||
    previewStackId === exitingStackId
  )
    return 1
  return Math.max(0, Math.min(1, peerOpacity))
}

/**
 * Live gather-card bridge for the *leaving* stack after handoff.
 *
 * Binary hold (never semi-transparent over the composite): stacking two dual
 * box-shadows reads as a dark “shadow flash”. Bridge owns the fan until settle
 * completes; composite only paints once bridge is gone.
 */
export function exitLeavingFanBridgeOpacity(settle: number): number {
  return Math.max(0, Math.min(1, settle)) >= 0.98 ? 0 : 1
}

/** Inverse of bridge — at most one fan layer (and its shadows) is visible. */
export function exitLeavingFanCompositeOpacity(settle: number): number {
  return exitLeavingFanBridgeOpacity(settle) > 0.5 ? 0 : 1
}
