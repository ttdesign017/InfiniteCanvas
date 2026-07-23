/**
 * Rigid stack on the parent canvas: folder chrome + fan cards + count badge.
 *
 * While dragging, the whole unit rides `--drag-dx/--drag-dy` on `.canvas-world`
 * (same path as multi-image drag). Fan cards are not store-rewritten mid-drag —
 * they only rebuild when surface model data changes (enter / content edits).
 */

import type { CSSProperties, ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import {
  getDragPoseVersion,
  isDragPoseMemberStack,
  subscribeDragPose,
} from '../utils/dragPosePreview'

export function StackUnit({
  stackId,
  scatterStyle,
  className,
  children,
}: {
  stackId: string
  /** Exit-peer scatter (opacity/transform) when non-null */
  scatterStyle?: CSSProperties | null
  className?: string
  children: ReactNode
}) {
  const isDragging = useSyncExternalStore(
    subscribeDragPose,
    () => {
      void getDragPoseVersion()
      return isDragPoseMemberStack(stackId)
    },
    () => false,
  )

  // Scatter (nav anim) owns transform when present; else pure drag CSS vars.
  // Children keep absolute world coords — translating this host moves folder+fan+count as one.
  let style: CSSProperties | undefined
  if (scatterStyle) {
    style = scatterStyle
  } else if (isDragging) {
    style = {
      transform: 'translate(var(--drag-dx, 0px), var(--drag-dy, 0px))',
    }
  }

  return (
    <div
      className={`stack-unit-wrap${isDragging ? ' is-stack-drag' : ''}${
        scatterStyle ? ' is-scatter' : ''
      }${className ? ` ${className}` : ''}`}
      data-stack-unit={stackId}
      style={style}
    >
      {children}
    </div>
  )
}
