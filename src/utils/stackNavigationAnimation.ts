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
