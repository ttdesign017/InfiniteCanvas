import type { RefObject } from 'react'
import { useSyncExternalStore } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import type { GroupScaleHandle } from '../utils/selectionBounds'
import {
  getDragPoseVersion,
  isDragPoseActive,
  subscribeDragPose,
} from '../utils/dragPosePreview'
import { captureJointMoveSelection } from '../hooks/useInfiniteCanvasController'
import {
  blurChrome,
  dismissStackNameEdit,
  isInteractionLocked,
} from '../hooks/canvas/canvasUiHelpers'
import type { DragMode } from '../hooks/canvas/dragTypes'

/**
 * Multi-select bbox — tracks multi-drag via CSS vars on `.canvas-world`
 * (no per-frame React updates; same model as pan).
 */
export function GroupSelectionBox({
  groupBounds,
  cHeld,
  dragRef,
  surfaceRef,
  flushDragWrite,
  onGroupScalePointerDown,
}: {
  groupBounds: { x: number; y: number; width: number; height: number }
  cHeld: boolean
  dragRef: RefObject<DragMode | null>
  surfaceRef: RefObject<HTMLDivElement | null>
  flushDragWrite: () => void
  onGroupScalePointerDown: (
    e: React.PointerEvent,
    handle: GroupScaleHandle,
  ) => void
}) {
  // Only flips at drag begin/end
  const dragging = useSyncExternalStore(
    subscribeDragPose,
    () => {
      void getDragPoseVersion()
      return isDragPoseActive()
    },
    () => false,
  )
  const transform = dragging
    ? `translate(calc(${groupBounds.x}px + var(--drag-dx, 0px)), calc(${groupBounds.y}px + var(--drag-dy, 0px)))`
    : `translate(${groupBounds.x}px, ${groupBounds.y}px)`

  return (
    <div
      className="group-selection-box"
      style={{
        transform,
        width: groupBounds.width,
        height: groupBounds.height,
        zIndex: 100000,
        pointerEvents: cHeld ? 'none' : 'auto',
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const store = useCanvasStore.getState()
        if (store.cHeld || store.spaceHeld || store.tool === 'pan') return
        if (
          (e.target as HTMLElement).closest?.(
            '.group-scale-handle, .group-scale-edge',
          )
        )
          return
        e.stopPropagation()
        if (isInteractionLocked()) return
        dismissStackNameEdit()
        blurChrome()
        flushDragWrite()
        const joint = captureJointMoveSelection(store)
        if (joint.ids.length === 0 && joint.stackIds.length === 0) return
        const ref = dragRef as React.MutableRefObject<DragMode>
        ref.current = {
          kind: 'pending-move',
          itemId: joint.ids[0] || joint.stackIds[0] || 'group',
          isStacked: false,
          canEditText: false,
          startClientX: e.clientX,
          startClientY: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          ids: joint.ids,
          origins: joint.origins,
          stackIds: joint.stackIds,
          stackOrigins: joint.stackOrigins,
          duplicated: false,
          altHeld: e.altKey,
        }
        surfaceRef.current?.setPointerCapture(e.pointerId)
      }}
    >
      {(['n', 'e', 's', 'w'] as GroupScaleHandle[]).map((h) => (
        <div
          key={h}
          className={`group-scale-edge edge-${h}`}
          onPointerDown={(e) => onGroupScalePointerDown(e, h)}
        />
      ))}
      {(['nw', 'ne', 'sw', 'se'] as GroupScaleHandle[]).map((h) => (
        <div
          key={h}
          className={`group-scale-handle handle-${h}`}
          onPointerDown={(e) => onGroupScalePointerDown(e, h)}
        />
      ))}
    </div>
  )
}
