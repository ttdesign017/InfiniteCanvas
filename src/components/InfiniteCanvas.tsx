import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { bindDragPoseHost } from '../utils/dragPosePreview'
import type { StackEnterAnim } from '../store/types'
import type { CanvasItem, StackRecord } from '../types/canvas'
import { CanvasItemView } from './items/CanvasItemView'
import { EmptyState } from './EmptyState'
import { StackFolder } from './StackFolder'
import { StackUnit } from './StackUnit'
import { CollapsedStackFans } from './CollapsedStackFans'
import { GroupSelectionBox } from './GroupSelectionBox'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { containerOf, countLeafItemsInStack, migrateLegacyStacks } from '../utils/stacks'
import { embedDisplayItem, resolveEmbedWorldPose } from '../utils/embedPose'
import {
  exitLeavingFanBridgeOpacity,
  exitLeavingFanCompositeOpacity,
  exitPeerStackPreviewOpacity,
} from '../utils/stackNavigationAnimation'
import { useStackAnimProgress } from '../utils/stackAnimProgress'
import {
  getStackFanComposite,
  stackFanNeedsLiveText,
} from '../utils/stackFanComposite'
import { stackFanEdgeOpacityForNav } from '../utils/stackFanChrome'
import {
  getSnapGuides,
  getSnapGuidesVersion,
  subscribeSnapGuides,
} from '../utils/snapGuidesBus'
import { stackCountPaintZ, stackFolderPaintZ } from '../utils/zOrder'
import {
  freeItemWrapAllowsPointer,
  peerScatterStyle,
  peerScatterWrapClassName,
  rectCenter,
} from '../utils/peerScatter'
import {
  captureJointMoveSelection,
  useInfiniteCanvasController,
} from '../hooks/useInfiniteCanvasController'

/**
 * Parent-peer ghost fan: prefer the already-cached composite bitmap so enter/exit
 * handoff never remounts live cards for a sibling that has not changed.
 * Falls back to static live cards only when no bitmap exists yet.
 */
function PeerGhostFanLayer({
  stackId,
  stackX,
  stackY,
  folderZ,
  fanItems,
}: {
  stackId: string
  stackX: number
  stackY: number
  folderZ: number
  fanItems: CanvasItem[]
}) {
  const cached = getStackFanComposite(stackId)
  if (
    cached &&
    fanItems.length > 0 &&
    !stackFanNeedsLiveText(fanItems)
  ) {
    let z = folderZ + 1
    for (const f of fanItems) {
      if (f.zIndex > z) z = f.zIndex
    }
    return (
      <img
        className="stack-fan-composite"
        src={cached.url}
        alt=""
        draggable={false}
        decoding="sync"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: cached.width,
          height: cached.height,
          transform: `translate(${stackX + cached.relX}px, ${
            stackY + cached.relY
          }px)`,
          transformOrigin: 'top left',
          zIndex: z,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
    )
  }
  return (
    <>
      {fanItems.map((item) => (
        <div
          key={`peer-ghost-fan-${item.id}`}
          className="stack-preview-wrap"
          style={{ opacity: 1, pointerEvents: 'none' }}
        >
          <CanvasItemView
            item={item}
            selected={false}
            staticPreview
            onPointerDown={() => {}}
            onResizePointerDown={() => {}}
          />
        </div>
      ))}
    </>
  )
}

/** Owns pan/zoom transform only — children do not re-render when viewport moves. */
function CanvasWorldTransform({ children }: { children: ReactNode }) {
  const viewport = useCanvasStore((s) => s.viewport)
  const zoom = Math.max(0.05, viewport.zoom)
  const worldRef = useRef<HTMLDivElement>(null)

  // Host for multi-drag CSS vars (--drag-dx / --drag-dy): one style write / frame
  useEffect(() => {
    bindDragPoseHost(worldRef.current)
    return () => bindDragPoseHost(null)
  }, [])

  return (
    <div
      ref={worldRef}
      className="canvas-world"
      style={
        {
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})`,
          // Counter-scale selection chrome so corner handles stay constant on screen
          '--canvas-zoom': String(zoom),
          '--drag-dx': '0px',
          '--drag-dy': '0px',
        } as CSSProperties
      }
    >
      {children}
    </div>
  )
}

/** Isolated guide chrome — re-renders alone so multi-select snap stays free. */
function SnapGuidesLayer() {
  const viewport = useCanvasStore((s) => s.viewport)
  const guides = useSyncExternalStore(
    subscribeSnapGuides,
    () => {
      void getSnapGuidesVersion()
      return getSnapGuides()
    },
    getSnapGuides,
  )
  if (guides.length === 0) return null
  return (
    <>
      {guides.map((g, i) => {
        if (g.orientation === 'v') {
          const sx = g.pos * viewport.zoom + viewport.x
          return <div key={`sg-${i}`} className="snap-guide v" style={{ left: sx }} />
        }
        const sy = g.pos * viewport.zoom + viewport.y
        return <div key={`sg-${i}`} className="snap-guide h" style={{ top: sy }} />
      })}
    </>
  )
}

export function InfiniteCanvas() {
  const {
    surfaceRef,
    dragRef,
    marquee,
    cropOverlay,
    dropActive,
    modalXformKind,
    items,
    stacks,
    currentContainerId,
    tool,
    cHeld,
    stackEnterAnim,
    visibleItems,
    visibleStacks,
    sortedNonEmbeds,
    allEmbedItems,
    selectedSet,
    selectedStackSet,
    isGroupSelect,
    groupBounds,
    stackFolders,
    stackPreviewItems,
    flushDragWrite,
    blurChrome,
    isInteractionLocked,
    dismissStackNameEdit,
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
    cursor,
    isEnterAnim,
    isExitAnim,
    animStackRec,
    animParentId,
    exitingStackId,
    exitGhostParent,
    enterGhostParent,
    exitAfterHandoff,
    parentPeerGhostItems,
    parentPeerGhostStacks,
    parentPeerGhostStackIds,
    exitParentPeerStackIds,
    peerScatterOriginLocal,
    peerScatterOriginWorld,
  } = useInfiniteCanvasController()

  // Morph progress (t / settle / peerReveal / nestedChrome) — external bus so
  // the controller does not re-render every RAF; only this paint tree does.
  const animProgress = useStackAnimProgress()
  const peerReveal = Math.max(
    0,
    Math.min(1, animProgress.peerReveal ?? (isEnterAnim ? 1 : 0)),
  )
  const exitPeerOpacity = isExitAnim ? peerReveal : 1
  const navPeerOpacity = isEnterAnim
    ? peerReveal
    : isExitAnim
      ? exitPeerOpacity
      : 1
  // Live stacked cards: white edge ramps during exit gather so it is already
  // full before handoff (composite bitmap has the same final alpha baked in).
  const stackFanEdgeOpacity = stackFanEdgeOpacityForNav(
    isExitAnim ? 'exit' : isEnterAnim ? 'enter' : null,
    animProgress.t,
  )
  // After exit handoff: keep the leaving stack's gather cards mounted under the
  // *same React keys* as free items so they never unmount. continuousVp maps
  // local fan poses → parent stackPreview so the fan does not jump/blank while
  // CollapsedStackFans composite seats underneath, then this bridge fades out.
  const exitBridgeFans = useMemo(() => {
    if (!exitAfterHandoff || !exitingStackId) return [] as CanvasItem[]
    return stackPreviewItems.filter((it) => it.stackGroupId === exitingStackId)
  }, [exitAfterHandoff, exitingStackId, stackPreviewItems])
  const exitBridgeIdSet = useMemo(
    () => new Set(exitBridgeFans.map((it) => it.id)),
    [exitBridgeFans],
  )
  const freePaintItems = useMemo(() => {
    if (exitBridgeFans.length === 0) return sortedNonEmbeds
    const freeIds = new Set(sortedNonEmbeds.map((i) => i.id))
    const extra = exitBridgeFans.filter((i) => !freeIds.has(i.id))
    if (extra.length === 0) return sortedNonEmbeds
    return [...sortedNonEmbeds, ...extra].sort(
      (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
    )
  }, [sortedNonEmbeds, exitBridgeFans])
  const stackFolderStatic = useMemo(() => {
    const fansByStack = new Map<string, CanvasItem[]>()
    for (const item of stackPreviewItems) {
      const stackId = item.stackGroupId
      if (!stackId || parentPeerGhostStackIds.has(stackId)) continue
      const fans = fansByStack.get(stackId)
      if (fans) fans.push(item)
      else fansByStack.set(stackId, [item])
    }

    const result = new Map<
      string,
      {
        countN: number
        folderZ: number
        countZ: number
        unitFans: CanvasItem[]
        stackRec: StackRecord
      }
    >()
    for (const folder of stackFolders) {
      const folderZ = folder.isRecord
        ? stackFolderPaintZ(folder.record!, items, stacks)
        : Math.min(...folder.members.map((member) => member.zIndex)) - 1
      result.set(folder.gid, {
        countN: countLeafItemsInStack(items, stacks, folder.gid),
        folderZ,
        countZ: folder.isRecord
          ? stackCountPaintZ(folder.record!, items, stacks)
          : Math.max(...folder.members.map((member) => member.zIndex), 1) + 2,
        unitFans: fansByStack.get(folder.gid) ?? [],
        stackRec: folder.record ?? {
          id: folder.gid,
          parentId: currentContainerId,
          name: folder.name,
          x: folder.bounds.x,
          y: folder.bounds.y,
          width: folder.bounds.width,
          height: folder.bounds.height,
          zIndex: folderZ,
        },
      })
    }
    return result
  }, [
    currentContainerId,
    items,
    parentPeerGhostStackIds,
    stackFolders,
    stackPreviewItems,
    stacks,
  ])
  const embedPaintModels = useMemo(
    () =>
      allEmbedItems.map((item) => {
        let pose = resolveEmbedWorldPose(item, currentContainerId, stacks)
        if (
          (exitGhostParent || enterGhostParent) &&
          animStackRec &&
          animParentId &&
          !pose.visible
        ) {
          const parentPose = resolveEmbedWorldPose(item, animParentId, stacks)
          if (parentPose.visible) {
            pose = {
              ...parentPose,
              x: parentPose.x - animStackRec.x,
              y: parentPose.y - animStackRec.y,
            }
          }
        }
        return {
          item,
          pose,
          display: embedDisplayItem(item, pose),
          isExitingFan:
            pose.asPreview && pose.stackGroupId === exitingStackId,
          isPeerGhostPreview:
            pose.asPreview &&
            pose.stackGroupId != null &&
            parentPeerGhostStackIds.has(pose.stackGroupId),
        }
      }),
    [
      allEmbedItems,
      animParentId,
      animStackRec,
      currentContainerId,
      enterGhostParent,
      exitGhostParent,
      exitingStackId,
      parentPeerGhostStackIds,
      stacks,
    ],
  )
  const peerBlurEnabled =
    stackFolders.length +
      parentPeerGhostStacks.length +
      parentPeerGhostItems.length +
      freePaintItems.length <=
    12
  const exitBridgeOp = exitAfterHandoff
    ? exitLeavingFanBridgeOpacity(animProgress.settle)
    : 0
  return (
    <div
      ref={surfaceRef}
      className={`canvas-surface ${dropActive ? 'drop-active' : ''} ${cHeld ? 'crop-mode' : ''} ${modalXformKind ? 'modal-xform' : ''} ${isGroupSelect ? 'is-group-select' : ''}`}
      style={
        {
          cursor,
          // Used by .media-item.is-stacked::after and note/bookmark fan chrome
          '--stack-fan-edge-opacity': String(stackFanEdgeOpacity),
        } as CSSProperties
      }
      tabIndex={0}
      role="application"
      aria-label="IC2 creative inspiration canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {modalXformKind && (
        <div className="modal-xform-hud" aria-live="polite">
          {modalXformKind === 'grab' && 'Move (G) — LMB confirm · RMB cancel'}
          {modalXformKind === 'rotate' &&
            'Rotate (R) — Shift 15° · LMB confirm · RMB cancel'}
          {modalXformKind === 'scale' && 'Scale (S) — LMB confirm · RMB cancel'}
        </div>
      )}
      <CanvasWorldTransform>
        <div className="canvas-grid" />
        {/* Folder chrome for nested stacks + legacy groups */}
        {stackFolders.map((f) => {
          // A persistent exit-peer layer below owns this stack until the fade
          // reaches 1. Avoid mounting a second real folder at handoff.
          if (exitParentPeerStackIds.has(f.gid)) return null
          // During exit settle, real folder fades in under morph overlay
          const isExitFolder =
            stackEnterAnim?.mode === 'exit' &&
            stackEnterAnim.stackId === f.gid
          // Other stacks on parent fade in with exit settle (not the one we just left)
          const folderOpacity =
            isExitFolder
              ? Math.max(0, Math.min(1, animProgress.settle))
              : exitAfterHandoff
                ? exitPeerOpacity
                : 1
          const folderStatic = stackFolderStatic.get(f.gid)!
          const { countN, folderZ, countZ, unitFans, stackRec } = folderStatic
          // Nested child stack chrome (B inside A): fade with enter/exit anim
          const childOfAnim =
            stackEnterAnim &&
            stacks.some(
              (s) =>
                s.id === f.gid && s.parentId === stackEnterAnim.stackId,
            )
          const nestedChrome =
            childOfAnim && stackEnterAnim
              ? Math.max(0, Math.min(1, animProgress.nestedChromeOpacity))
              : 1
          const folderOp = folderOpacity * nestedChrome
          // After exit handoff, sibling stacks share ghost scatter so opacity/transform match
          const isExitPeerFolder =
            exitAfterHandoff &&
            !isExitFolder &&
            f.gid !== exitingStackId &&
            peerScatterOriginWorld != null
          const folderScatter = isExitPeerFolder
            ? peerScatterStyle(
                rectCenter(f.bounds),
                peerScatterOriginWorld,
                folderOp,
                f.gid,
                peerBlurEnabled,
              )
            : null
          const folderChromeOp = folderScatter ? 1 : folderOp
          // Fan cards belonging to this stack — nested under StackUnit so drag moves as one.
          // Leaving stack: still build composite under the free-item bridge (same cards).
          // Scatter wrapper already owns peer opacity — don't multiply again on fans.
          // Leaving stack: composite stays at 0 while live bridge owns the fan
          // (semi-overlap double-paints dual box-shadows → dark shadow flash).
          const unitFanOpacity = folderScatter
            ? 1
            : isExitFolder
              ? exitLeavingFanCompositeOpacity(animProgress.settle)
              : exitPeerStackPreviewOpacity(
                  exitAfterHandoff,
                  exitingStackId,
                  f.gid,
                  exitPeerOpacity,
                )
          // Live fan DOM only while THIS stack (or nested child) is morphing
          // *before* exit handoff. After handoff fan poses are final — always
          // prefer the cached composite so shadow/edge match the ghost layer.
          // Exit-peer scatter must never forceLive (sibling flash).
          const forceLiveFans = !!(
            stackEnterAnim &&
            !(stackEnterAnim.mode === 'exit' && exitAfterHandoff) &&
            (stackEnterAnim.stackId === f.gid ||
              stacks.some(
                (s) =>
                  s.id === f.gid && s.parentId === stackEnterAnim.stackId,
              ))
          )
          return (
          <StackUnit
            key={`folder-wrap-${f.gid}`}
            stackId={f.gid}
            scatterStyle={folderScatter}
            className={
              folderScatter
                ? peerScatterWrapClassName({ isGhost: false })
                : undefined
            }
          >
          <StackFolder
            groupId={f.gid}
            members={f.members}
            bounds={f.bounds}
            selected={f.selected}
            dropTarget={f.dropTarget}
            zIndex={folderZ}
            name={f.name}
            styleOpacity={folderChromeOp}
            count={countN}
            countZIndex={countZ}
            onEnter={() => {
              if (isInteractionLocked()) return
              const st = useCanvasStore.getState()
              const vp = st.viewport
              // Ensure stack exists as a record (legacy migrate path)
              if (!st.stacks.some((s) => s.id === f.gid) && f.members.length) {
                const live = useCanvasStore.getState()
                const migrated = migrateLegacyStacks(live.items, live.stacks)
                useCanvasStore.setState({
                  items: migrated.items,
                  stacks: migrated.stacks,
                })
              }
              st.enterStack(f.gid, {
                x: f.bounds.x * vp.zoom + vp.x,
                y: f.bounds.y * vp.zoom + vp.y,
                w: f.bounds.width * vp.zoom,
                h: f.bounds.height * vp.zoom,
              })
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              const store = useCanvasStore.getState()
              if (isInteractionLocked()) {
                e.preventDefault()
                e.stopPropagation()
                return
              }
              dismissStackNameEdit()
              blurChrome()
              flushDragWrite()
              if (store.spaceHeld || store.tool === 'pan') return
              if (store.tool === 'scribble' || store.tool === 'erase') return
              e.stopPropagation()

              const additive = e.shiftKey || e.ctrlKey || e.metaKey
              if (f.isRecord) {
                if (additive) {
                  store.selectStacks([f.gid], true)
                } else if (!store.selectedStackIds.includes(f.gid)) {
                  // New primary stack selection (clears free items)
                  store.selectStacks([f.gid])
                }
                // Already multi-selected: keep free items + all selected stacks
                const joint = captureJointMoveSelection(
                  useCanvasStore.getState(),
                )
                if (!joint.stackIds.includes(f.gid)) {
                  joint.stackIds = [...joint.stackIds, f.gid]
                  const st = store.stacks.find((s) => s.id === f.gid)
                  if (st) joint.stackOrigins[f.gid] = { x: st.x, y: st.y }
                }
                dragRef.current = {
                  kind: 'pending-move',
                  itemId: f.gid,
                  isStacked: true,
                  stackGroupId: f.gid,
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
                return
              }
              // Legacy: drag via proxy members
              if (f.proxy) onItemPointerDown(e, f.proxy)
            }}
          />
          {/* Count rides with StackUnit (same CSS drag as folder + fan) */}
          {countN > 0 && folderOp > 0.05 && (
            <span
              className="stack-folder-label stack-count-float"
              style={{
                transform: `translate(${f.bounds.x + f.bounds.width - 12}px, ${
                  f.bounds.y + f.bounds.height - 10
                }px) translate(-100%, -100%)`,
                zIndex: countZ,
                opacity: folderChromeOp,
                pointerEvents: 'none',
              }}
            >
              {countN}
            </span>
          )}
          {/* Fan: one composite bitmap when settled (pan/zoom ≈ 1 image per stack) */}
          <CollapsedStackFans
            stack={stackRec}
            items={items}
            stacks={stacks}
            fanItems={unitFans}
            opacity={unitFanOpacity}
            selected={selectedStackSet.has(f.gid)}
            forceLive={forceLiveFans}
            zIndexBase={folderZ + 1}
          />
          </StackUnit>
          )
        })}
        {/*
          Parent peers (enter fade-out / exit fade-in): continuous ghost layer
          so container switch never pops same-level items off instantly.
        */}
        {parentPeerGhostStacks.map((peer) => {
          const scatter =
            peerScatterOriginLocal != null
              ? peerScatterStyle(
                  rectCenter(peer.bounds),
                  peerScatterOriginLocal,
                  navPeerOpacity,
                  peer.stack.id,
                  peerBlurEnabled,
                )
              : { opacity: navPeerOpacity }
          return (
          <div
            key={`peer-ghost-stack-${peer.stack.id}`}
            className={peerScatterWrapClassName({ isGhost: true })}
            style={scatter}
          >
            <StackFolder
              groupId={peer.stack.id}
              members={[]}
              bounds={peer.bounds}
              selected={false}
              zIndex={peer.folderZ}
              name={peer.stack.name}
              styleOpacity={1}
              count={peer.count}
              countZIndex={peer.countZ}
              onPointerDown={() => {}}
            />
            {peer.count > 0 && navPeerOpacity > 0.05 && (
              <span
                className="stack-folder-label stack-count-float"
                style={{
                  transform: `translate(${peer.bounds.x + peer.bounds.width - 12}px, ${
                    peer.bounds.y + peer.bounds.height - 10
                  }px) translate(-100%, -100%)`,
                  zIndex: peer.countZ,
                  opacity: 1,
                  pointerEvents: 'none',
                }}
              >
                {peer.count}
              </span>
            )}
            {/*
              Paint the cached fan bitmap when present (same pixels as the settled
              parent layer). Do NOT run CollapsedStackFans rebuild here — ghost
              stack.x/y is continuous-local and would poison content keys.
            */}
            <PeerGhostFanLayer
              stackId={peer.stack.id}
              stackX={peer.stack.x}
              stackY={peer.stack.y}
              folderZ={peer.folderZ}
              fanItems={peer.fanItems}
            />
          </div>
          )
        })}
        {parentPeerGhostItems.map((item) => {
          const scatter =
            peerScatterOriginLocal != null
              ? peerScatterStyle(
                  {
                    x: item.x + item.width / 2,
                    y: item.y + item.height / 2,
                  },
                  peerScatterOriginLocal,
                  navPeerOpacity,
                  item.id,
                  peerBlurEnabled,
                )
              : { opacity: navPeerOpacity }
          return (
          <div
            key={`peer-ghost-item-${item.id}`}
            className={`peer-fade-wrap ${peerScatterWrapClassName({ isGhost: true })}`}
            style={scatter}
          >
            <CanvasItemView
              item={item}
              selected={false}
              staticPreview
              onPointerDown={() => {}}
              onResizePointerDown={() => {}}
            />
          </div>
          )
        })}
        {/*
          Free items + exit fan bridge (same key={id} as gather cards).
          After handoff the leaving stack's cards stay here so React reuses the
          live DOM; composite seats underneath via CollapsedStackFans.
        */}
        {freePaintItems.map((item) => {
          const isExitBridge = exitBridgeIdSet.has(item.id)
          const peerOp = exitAfterHandoff && !isExitBridge ? exitPeerOpacity : 1
          // Exit stack: scribbles vanish quickly (not part of gather fan)
          const scribbleExitFade =
            item.type === 'scribble' &&
            stackEnterAnim?.mode === 'exit' &&
            (containerOf(item) === stackEnterAnim.stackId ||
              item.stackGroupId === stackEnterAnim.stackId)
              ? Math.max(0, 1 - Math.min(1, animProgress.t / 0.18))
              : 1
          // Leaving-stack bridge must not peer-scatter — it is the focus pile
          const scattering =
            exitAfterHandoff &&
            !isExitBridge &&
            peerScatterOriginWorld != null
          const scatter = scattering
            ? peerScatterStyle(
                {
                  x: item.x + item.width / 2,
                  y: item.y + item.height / 2,
                },
                peerScatterOriginWorld,
                peerOp,
                item.id,
                peerBlurEnabled,
              )
            : { opacity: peerOp }
          const bridgeMul = isExitBridge ? exitBridgeOp : 1
          const combinedOp =
            (typeof scatter.opacity === 'number' ? scatter.opacity : 1) *
            scribbleExitFade *
            bridgeMul
          // Live free items must stay clickable; bridge is visual-only
          const scatterClass = scattering
            ? peerScatterWrapClassName({ isGhost: false })
            : ''
          const allowPointer =
            isExitBridge || scribbleExitFade < 0.05
              ? false
              : freeItemWrapAllowsPointer(exitAfterHandoff, peerOp)
          if (isExitBridge && combinedOp < 0.02) return null
          return (
          <div
            key={item.id}
            className={`peer-fade-wrap${scatterClass ? ` ${scatterClass}` : ''}${
              isExitBridge ? ' is-exit-fan-bridge' : ''
            }`}
            style={{
              ...scatter,
              opacity: combinedOp,
              // Explicit override so a stuck handoff style cannot brick selection
              pointerEvents: allowPointer ? 'auto' : 'none',
            }}
          >
            <CanvasItemView
              item={item}
              selected={!isExitBridge && selectedSet.has(item.id)}
              // Keep live media path (no staticPreview flip) so gather cards
              // reuse the same DOM through handoff without a decoder remount.
              onPointerDown={onItemPointerDown}
              onResizePointerDown={onResizePointerDown}
            />
          </div>
          )
        })}
        {/* Multi-select group bounding box (2+ free items and/or stacks) */}
        {isGroupSelect && groupBounds && !stackEnterAnim && (
          <GroupSelectionBox
            groupBounds={groupBounds}
            cHeld={cHeld}
            dragRef={dragRef}
            surfaceRef={surfaceRef}
            flushDragWrite={flushDragWrite}
            onGroupScalePointerDown={onGroupScalePointerDown}
          />
        )}
        {/*
          Embed keepalive: every embed stays mounted for the board lifetime.
          Only pose/visibility change on stack enter/exit — iframe never remounts.
        */}
        {embedPaintModels.map(
          ({ item, pose, display, isExitingFan, isPeerGhostPreview }) => {
          const embedOp = !pose.visible
            ? 0
            : isExitingFan
              ? 1
              : isPeerGhostPreview
                ? navPeerOpacity
              : exitGhostParent || enterGhostParent || exitAfterHandoff
                ? // Free on current stack (inner members): full; parent ghosts: peer fade
                  containerOf(item) === currentContainerId && !pose.asPreview
                  ? 1
                  : navPeerOpacity
                : 1
          return (
            <div
              key={item.id}
              className={`embed-alive ${pose.visible ? 'is-shown' : 'is-hidden'}`}
              style={{ opacity: pose.visible ? embedOp : undefined }}
              aria-hidden={!pose.visible}
            >
              <CanvasItemView
                item={display}
                selected={
                  pose.visible &&
                  !pose.asPreview &&
                  selectedSet.has(item.id) &&
                  !exitGhostParent
                }
                onPointerDown={onItemPointerDown}
                onResizePointerDown={onResizePointerDown}
              />
            </div>
          )
          },
        )}
      </CanvasWorldTransform>

      {visibleItems.length === 0 &&
        visibleStacks.length === 0 &&
        currentContainerId === ROOT_CONTAINER_ID && <EmptyState />}

      {/* Stack folder morph: screen-space outer rect, world-scale chrome (matches canvas zoom) */}
      {stackEnterAnim && <StackMorphOverlay stackEnterAnim={stackEnterAnim} />}

      {marquee && (
        <div
          className={`marquee ${tool === 'textcard' ? 'create-note' : ''}`}
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.w,
            height: marquee.h,
          }}
        />
      )}

      {cropOverlay && (
        <div
          className="crop-rect"
          style={{
            left: cropOverlay.x,
            top: cropOverlay.y,
            width: cropOverlay.w,
            height: cropOverlay.h,
          }}
        />
      )}

      <SnapGuidesLayer />

      {dropActive && (
        <div className="drop-overlay">Drop media, URL, or text</div>
      )}
    </div>
  )
}

/** Screen-space folder morph; reads zoom + progress bus (not parent re-render). */
function StackMorphOverlay({
  stackEnterAnim,
}: {
  stackEnterAnim: StackEnterAnim
}) {
  const zoom = useCanvasStore((s) => Math.max(0.05, s.viewport.zoom))
  const progress = useStackAnimProgress()
  const t = progress.t
  const settle = progress.settle
  const a = stackEnterAnim.start
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const b =
    stackEnterAnim.end ??
    (stackEnterAnim.mode === 'enter'
      ? { x: 0, y: 0, w: vw, h: vh }
      : a)
  const x = a.x + (b.x - a.x) * t
  const y = a.y + (b.y - a.y) * t
  const w = Math.max(1, a.w + (b.w - a.w) * t)
  const h = Math.max(1, a.h + (b.h - a.h) * t)
  /*
   * CRITICAL scale match: real StackFolder lives inside .canvas-world
   * (transform scale(zoom)), so tab / badge / radius are in world units.
   * Morph is a surface overlay — layout in world units then scale(zoom).
   */
  const worldW = w / zoom
  const worldH = h / zoom
  const smooth = (u: number) => u * u * (3 - 2 * u)
  const clamp01 = (u: number) => Math.max(0, Math.min(1, u))
  const enterFade = clamp01(t / 0.92)
  const baseOp =
    stackEnterAnim.mode === 'exit'
      ? smooth(clamp01(t))
      : 1 - smooth(enterFade)
  const opacity =
    stackEnterAnim.mode === 'exit'
      ? baseOp * (1 - smooth(clamp01(settle)))
      : baseOp
  const detailT =
    stackEnterAnim.mode === 'exit' ? clamp01((t - 0.08) / 0.92) : 1
  const detailOp =
    stackEnterAnim.mode === 'exit'
      ? smooth(detailT) * (1 - smooth(clamp01(settle)))
      : 1
  const hasName = !!(stackEnterAnim.name || '').trim()
  const count = stackEnterAnim.memberCount ?? 0

  return (
    <div className="stack-enter-overlay" aria-hidden>
      <div
        className={`stack-enter-folder stack-folder-morph ${
          stackEnterAnim.mode === 'exit' ? 'is-exit' : 'is-enter'
        } ${hasName ? 'has-name' : 'is-compact'}`}
        style={{
          left: x,
          top: y,
          width: worldW,
          height: worldH,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
          opacity,
        }}
      >
        <div
          className={`stack-folder-tab ${
            hasName ? 'is-expanded' : 'is-compact'
          }`}
          style={{ opacity: detailOp }}
        >
          {hasName && (
            <span className="stack-folder-tab-label">
              {stackEnterAnim.name}
            </span>
          )}
        </div>
        <div className="stack-folder-body" />
        {count > 0 && (
          <span className="stack-folder-label" style={{ opacity: detailOp }}>
            {count}
          </span>
        )}
      </div>
    </div>
  )
}
