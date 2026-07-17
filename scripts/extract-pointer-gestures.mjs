/**
 * Extract pointer/drop handlers from useInfiniteCanvasController into
 * useCanvasPointerGestures, leave a thin composer behind.
 */
import fs from 'fs'

const ctrlPath = 'src/hooks/useInfiniteCanvasController.ts'
const outPath = 'src/hooks/canvas/useCanvasPointerGestures.ts'
let text = fs.readFileSync(ctrlPath, 'utf8').replace(/^\uFEFF/, '')
const lines = text.split(/\r?\n/)

const idx = (re, from = 0) => {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i
  return -1
}

const groupScale = idx(/const onGroupScalePointerDown/)
let returnLine = -1
for (let i = 0; i < lines.length; i++) {
  if (/^  return \{/.test(lines[i])) returnLine = i
}
const cursorLine = idx(/const cursor =/)

if (groupScale < 0 || cursorLine < 0 || returnLine < 0) {
  throw new Error(`bad markers ${groupScale} ${cursorLine} ${returnLine}`)
}

const handlersBody = lines.slice(groupScale, cursorLine).join('\n')
const head = lines.slice(0, groupScale).join('\n')
const tail = lines.slice(cursorLine).join('\n')

const gestureFile = `import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useCanvasStore } from '../../store/useCanvasStore'
import type { CanvasItem } from '../../types/canvas'
import { expandStackSelection, hitStackGroupAt, placeItemsTight, screenToWorld, stackCollapsedSnapBounds } from '../../utils/layout'
import { collectItemsInStackTree, containerOf } from '../../utils/stacks'
import { createMediaFromFile, createMediaFromPath } from '../../utils/media'
import { importDropAt } from '../../utils/dropImport'
import { computeResize, isEdgeResizeType } from '../../utils/resize'
import { computeSnapDelta, guidesEqual, snapResizeRect, type SnapGuide } from '../../utils/snap'
import { isDesktop, onNativeFileDrop, openExternal } from '../../utils/desktop'
import { clearTextScalePreview, getTextScalePreview, originFromHandle, scaledBoxFromPreview, setTextScalePreview } from '../../utils/textScalePreview'
import { applyGroupScale, computeSelectionBounds, groupFactorFromSnappedBox, groupScaleFactor, groupScaledBounds, isGroupScalableType, type GroupBodyOrigin, type GroupScaleHandle } from '../../utils/selectionBounds'
import { marqueeHitsRotatedItem } from '../../utils/geometry'
import { type DragMode } from './dragTypes'
import { captureJointMoveSelection } from './jointSelection'
import { CROP_ROTATED_HINT, DRAG_THRESHOLD_PX, resolveCropTargets } from './cropTargets'
import { blurChrome, dismissStackNameEdit, isInteractionLocked } from './canvasUiHelpers'

export type CanvasPointerGestureApi = {
  onGroupScalePointerDown: (
    e: React.PointerEvent,
    handle: GroupScaleHandle,
  ) => void
  onResizePointerDown: (
    e: React.PointerEvent,
    item: CanvasItem,
    handle: string,
  ) => void
  onItemPointerDown: (e: React.PointerEvent, item: CanvasItem) => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragEnter: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export function useCanvasPointerGestures(deps: {
  surfaceRef: RefObject<HTMLDivElement | null>
  dragRef: React.MutableRefObject<DragMode>
  eraseHistoryPushed: React.MutableRefObject<boolean>
  lastItemClickRef: React.MutableRefObject<{
    id: string
    t: number
    x: number
    y: number
  } | null>
  stackDropTargetRef: React.MutableRefObject<string | null>
  setStackDropTarget: (gid: string | null) => void
  setMarquee: Dispatch<
    SetStateAction<{ x: number; y: number; w: number; h: number } | null>
  >
  setCropOverlay: Dispatch<
    SetStateAction<{ x: number; y: number; w: number; h: number } | null>
  >
  setDropActive: Dispatch<SetStateAction<boolean>>
  setSnapGuides: Dispatch<SetStateAction<SnapGuide[]>>
  scheduleDragWrite: (fn: () => void) => void
  flushDragWrite: () => void
  getLocalPoint: (e: { clientX: number; clientY: number }) => {
    x: number
    y: number
  }
  effectiveTool: string
  isGroupSelect: boolean
  selectedSet: Set<string>
  selectedStackSet: Set<string>
  visibleItems: CanvasItem[]
  currentContainerId: string
}): CanvasPointerGestureApi {
  const {
    surfaceRef,
    dragRef,
    eraseHistoryPushed,
    lastItemClickRef,
    stackDropTargetRef,
    setStackDropTarget,
    setMarquee,
    setCropOverlay,
    setDropActive,
    setSnapGuides,
    scheduleDragWrite,
    flushDragWrite,
    getLocalPoint,
    effectiveTool,
    isGroupSelect,
    selectedSet,
    selectedStackSet,
    visibleItems,
    currentContainerId,
  } = deps

  void selectedSet
  void selectedStackSet
  void visibleItems
  void currentContainerId
  void effectiveTool
  void isGroupSelect
  void eraseHistoryPushed
  void lastItemClickRef
  void stackDropTargetRef
  void setStackDropTarget
  void onNativeFileDrop

${handlersBody}

  return {
    onGroupScalePointerDown,
    onResizePointerDown,
    onItemPointerDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
  }
}
`

fs.writeFileSync(outPath, gestureFile)

let headOut = head
if (!headOut.includes('useCanvasPointerGestures')) {
  headOut = headOut.replace(
    `import { useStackNavGhosts } from './canvas/useStackNavGhosts'`,
    `import { useStackNavGhosts } from './canvas/useStackNavGhosts'
import { useCanvasPointerGestures } from './canvas/useCanvasPointerGestures'`,
  )
}

// Strip gesture-only imports from controller (keep surface/orchestration imports)
const thin = `${headOut}

  const {
    onGroupScalePointerDown,
    onResizePointerDown,
    onItemPointerDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
  } = useCanvasPointerGestures({
    surfaceRef,
    dragRef,
    eraseHistoryPushed,
    lastItemClickRef,
    stackDropTargetRef,
    setStackDropTarget,
    setMarquee,
    setCropOverlay,
    setDropActive,
    setSnapGuides,
    scheduleDragWrite,
    flushDragWrite,
    getLocalPoint,
    effectiveTool,
    isGroupSelect,
    selectedSet,
    selectedStackSet,
    visibleItems,
    currentContainerId,
  })

${tail}
`

fs.writeFileSync(ctrlPath, thin)
console.log('gesture lines', gestureFile.split('\n').length)
console.log('controller lines', thin.split('\n').length)
