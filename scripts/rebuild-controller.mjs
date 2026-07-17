import fs from 'fs'

const path = 'src/hooks/useInfiniteCanvasController.ts'
let text = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
const lines = text.split(/\r?\n/)
const idx = (re, from = 0) => {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i
  return -1
}

const enterComment = idx(/Drive enter-stack folder expand/)
// IMPORTANT: search FORWARD for the enter-stack useEffect (not previous modal useEffect)
const enterUseEffect = idx(/^\s*useEffect\(/, enterComment)
const stackFolders = idx(/const stackFolders = useMemo/)
const getLocal = idx(/const getLocalPoint/)
const scheduleOld = idx(/const scheduleDragWrite/)
const wheelOn = idx(/const onWheel/)
let wheelEff = wheelOn
while (wheelEff > 0 && !/^\s*useEffect\(/.test(lines[wheelEff])) wheelEff--
const blurChrome = idx(/const blurChrome =/)
const groupScale = idx(/const onGroupScalePointerDown/)
const cursorLine = idx(/const cursor =/)
const isEnter = idx(/const isEnterAnim/)
// Final hook return is the LAST "  return {" in the monofile (not captureJoint's).
let returnLine = -1
for (let i = 0; i < lines.length; i++) {
  if (/^  return \{/.test(lines[i])) returnLine = i
}
if (returnLine < 0) throw new Error('final return not found')

if (enterUseEffect < 0 || enterUseEffect > stackFolders) {
  throw new Error(
    `bad enter slice: enterUseEffect=${enterUseEffect} stackFolders=${stackFolders} comment=${enterComment}`,
  )
}

const enterBlock = lines.slice(enterUseEffect, stackFolders).join('\n')
const getLocalBlock = lines.slice(getLocal, scheduleOld).join('\n')
const wheelBlock = lines.slice(wheelEff, blurChrome).join('\n')
const handlers = lines.slice(groupScale, cursorLine).join('\n')
const cursorOnly = lines.slice(cursorLine, isEnter).join('\n')
const returnBlock = lines.slice(returnLine).join('\n')

console.log('slices', {
  enter: [enterUseEffect + 1, stackFolders],
  enterLines: enterBlock.split('\n').length,
  handlers: handlers.split('\n').length,
  getLocal: getLocal + 1,
  wheel: wheelEff + 1,
})

const header = `import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import type { CanvasItem, MediaItem } from '../types/canvas'
import { expandStackSelection, hitStackGroupAt, placeItemsTight, screenToWorld, stackCollapsedSnapBounds } from '../utils/layout'
import { collectItemsInStackTree, containerOf } from '../utils/stacks'
import { pruneEmbedIframes } from '../utils/embedIframeCache'
import { createMediaFromFile, createMediaFromPath } from '../utils/media'
import { importDropAt } from '../utils/dropImport'
import { computeResize, isEdgeResizeType } from '../utils/resize'
import { computeSnapDelta, guidesEqual, snapResizeRect, type SnapGuide } from '../utils/snap'
import { isDesktop, onNativeFileDrop, openExternal } from '../utils/desktop'
import { clearTextScalePreview, getTextScalePreview, originFromHandle, scaledBoxFromPreview, setTextScalePreview } from '../utils/textScalePreview'
import { applyGroupScale, computeSelectionBounds, groupFactorFromSnappedBox, groupScaleFactor, groupScaledBounds, isGroupScalableType, type GroupBodyOrigin, type GroupScaleHandle } from '../utils/selectionBounds'
import { marqueeHitsRotatedItem } from '../utils/geometry'
import {
  CROP_ROTATED_HINT,
  DRAG_THRESHOLD_PX,
  captureJointMoveSelection,
  resolveCropTargets,
  type DragMode,
} from './canvas'
import { blurChrome, dismissStackNameEdit, isInteractionLocked } from './canvas/canvasUiHelpers'
import { useCanvasSurfaceModel } from './canvas/useCanvasSurfaceModel'
import { useDragWriteScheduler } from './canvas/useDragWriteScheduler'
import { useModalTransformHotkeys } from './canvas/useModalTransformHotkeys'
import { useStackNavGhosts } from './canvas/useStackNavGhosts'

export { captureJointMoveSelection } from './canvas'

export function useInfiniteCanvasController() {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragMode>(null)
  const eraseHistoryPushed = useRef(false)
  const lastItemClickRef = useRef<{
    id: string
    t: number
    x: number
    y: number
  } | null>(null)
  const [marquee, setMarquee] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [cropOverlay, setCropOverlay] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([])
  const [stackDropTargetId, setStackDropTargetId] = useState<string | null>(
    null,
  )
  const stackDropTargetRef = useRef<string | null>(null)

  const setStackDropTarget = useCallback((gid: string | null) => {
    stackDropTargetRef.current = gid
    setStackDropTargetId(gid)
  }, [])

  const { scheduleDragWrite, flushDragWrite } = useDragWriteScheduler()
  const { modalXformRef, modalXformKind, lastPointerRef } =
    useModalTransformHotkeys({ setSnapGuides })

  const items = useCanvasStore((s) => s.items)
  const stacks = useCanvasStore((s) => s.stacks)
  const currentContainerId = useCanvasStore((s) => s.currentContainerId)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const selectedStackIds = useCanvasStore((s) => s.selectedStackIds)
  const viewport = useCanvasStore((s) => s.viewport)
  const tool = useCanvasStore((s) => s.tool)
  const spaceHeld = useCanvasStore((s) => s.spaceHeld)
  const cHeld = useCanvasStore((s) => s.cHeld)
  const isPanning = useCanvasStore((s) => s.isPanning)
  const stackEnterAnim = useCanvasStore((s) => s.stackEnterAnim)
  const setStackEnterAnim = useCanvasStore((s) => s.setStackEnterAnim)

  // Drop keep-alive iframes when their embed items are deleted from the board
  useEffect(() => {
    const live = new Set(
      items.filter((i) => i.type === 'embed').map((i) => i.id),
    )
    pruneEmbedIframes(live)
  }, [items])

  const {
    visibleItems,
    visibleStacks,
    sortedNonEmbeds,
    allEmbedItems,
    selectedSet,
    selectedStackSet,
    isGroupSelect,
    groupBounds,
    effectiveTool,
    stackFolders,
    stackPreviewItems,
  } = useCanvasSurfaceModel({
    items,
    stacks,
    currentContainerId,
    selectedIds,
    selectedStackIds,
    stackDropTargetId,
    tool,
    spaceHeld,
    cHeld,
  })

  const navGhosts = useStackNavGhosts({
    items,
    stacks,
    currentContainerId,
    stackEnterAnim,
  })
`

const body = [
  header,
  enterBlock,
  '',
  getLocalBlock,
  '',
  wheelBlock,
  '',
  handlers,
  '',
  cursorOnly,
  '',
  '  const {',
  '    animStackRec,',
  '    animParentId,',
  '    exitingStackId,',
  '    exitGhostParent,',
  '    enterGhostParent,',
  '    exitPeerOpacity,',
  '    exitAfterHandoff,',
  '    parentPeerGhostItems,',
  '    parentPeerGhostStacks,',
  '    parentPeerGhostStackIds,',
  '    exitParentPeerStackIds,',
  '    navPeerOpacity,',
  '  } = navGhosts',
  '',
  returnBlock,
].join('\n')

fs.writeFileSync(path, body)
console.log('written', body.split('\n').length, 'lines')
