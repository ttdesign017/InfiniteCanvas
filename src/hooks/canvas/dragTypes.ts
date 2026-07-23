/**
 * Pointer-session state for the infinite canvas controller.
 * Kept out of the main hook file so drag modes stay readable and importable.
 */

import type { GroupBodyOrigin, GroupScaleHandle } from '../../utils/selectionBounds'

/** Screen px before a press becomes a real drag (preserves double-click edit) */
export const DRAG_THRESHOLD_PX = 5

export type DragMode =
  | null
  | { kind: 'pan'; lastX: number; lastY: number }
  | {
      /** Click vs drag: not yet moved past threshold — no history / no position write */
      kind: 'pending-move'
      itemId: string
      isStacked: boolean
      stackGroupId?: string
      canEditText: boolean
      /** Double-click reopens a scribble layer for more strokes */
      canEditScribble?: boolean
      /** Link double-click open (pointer-capture often kills native dblclick) */
      canOpenLink?: boolean
      linkUrl?: string
      startClientX: number
      startClientY: number
      lastX: number
      lastY: number
      ids: string[]
      origins: Record<string, { x: number; y: number }>
      stackIds?: string[]
      stackOrigins?: Record<string, { x: number; y: number }>
      duplicated: boolean
      altHeld: boolean
    }
  | {
      kind: 'move'
      ids: string[]
      /** Nested stack folder ids being moved on this canvas */
      stackIds?: string[]
      stackOrigins?: Record<string, { x: number; y: number }>
      lastX: number
      lastY: number
      moved: boolean
      /** Alt-drag duplicate already performed */
      duplicated: boolean
      altHeld: boolean
      /** Positions at drag start (pre-snap free tracking) */
      origins: Record<string, { x: number; y: number }>
      accDx: number
      accDy: number
      /** Last snapped world delta pushed to dragPosePreview */
      appliedDx: number
      appliedDy: number
      /** Geometry at drag start — avoid per-frame store scans for snap */
      sizeById: Record<
        string,
        { width: number; height: number; rotation: number; type: string }
      >
      stackSizeById: Record<string, { width: number; height: number }>
      /** CSS-var drag session started (beginDragPose already called) */
      poseSession?: boolean
    }
  | {
      kind: 'marquee'
      startX: number
      startY: number
      x: number
      y: number
      w: number
      h: number
      additive: boolean
    }
  | {
      kind: 'resize'
      id: string
      handle: string
      startX: number
      startY: number
      orig: { x: number; y: number; width: number; height: number }
      /** note/link/text edges → single side; media → uniform scale */
      edgeMode: 'scale' | 'edge'
      isMedia: boolean
      /** Free text: corners also scale fontSize */
      isText: boolean
      origFontSize?: number
      /** Last Shift-scale factor (survives preview clear race) */
      lastTextScale?: number
      /** True if last move used text live CSS scale path */
      textScaleActive?: boolean
    }
  | {
      /** Multi-selection proportional scale from a corner of the group bbox */
      kind: 'group-scale'
      handle: GroupScaleHandle
      bounds: { x: number; y: number; width: number; height: number }
      bodies: GroupBodyOrigin[]
    }
  | {
      kind: 'scribble'
      id: string
      pendingWorld: Array<{ x: number; y: number }>
      lastWorld: { x: number; y: number }
    }
  | { kind: 'erase'; erased: boolean }
  | {
      kind: 'crop'
      /** One or more free media (non-rotated) to crop with the same marquee */
      ids: string[]
      startWorld: { x: number; y: number }
      currentWorld: { x: number; y: number }
    }
  | {
      kind: 'create-note'
      startWorld: { x: number; y: number }
      startLocal: { x: number; y: number }
      x: number
      y: number
      w: number
      h: number
    }
