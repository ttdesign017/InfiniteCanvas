import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { bindDragPoseHost } from '../utils/dragPosePreview'
import type { StackEnterAnim } from '../store/types'
import { CanvasItemView } from './items/CanvasItemView'
import { EmptyState } from './EmptyState'
import { StackFolder } from './StackFolder'
import { StackUnit } from './StackUnit'
import { CollapsedStackFans } from './CollapsedStackFans'
import { GroupSelectionBox } from './GroupSelectionBox'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { containerOf, countLeafItemsInStack, migrateLegacyStacks } from '../utils/stacks'
import { embedDisplayItem, resolveEmbedWorldPose } from '../utils/embedPose'
import { exitPeerStackPreviewOpacity } from '../utils/stackNavigationAnimation'
import { useStackAnimProgress } from '../utils/stackAnimProgress'
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
  return (
    <div
      ref={surfaceRef}
      className={`canvas-surface ${dropActive ? 'drop-active' : ''} ${cHeld ? 'crop-mode' : ''} ${modalXformKind ? 'modal-xform' : ''} ${isGroupSelect ? 'is-group-select' : ''}`}
      style={{ cursor }}
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
          // Leaf items only (nested stack folders are not counted as items)
          const countN = countLeafItemsInStack(items, stacks, f.gid)
          // Folder uses reserved stack.zIndex when allocation is contiguous;
          // never paint at min(leaf)-1 (that lets sibling fans sit between
          // folder and this stack's own cards).
          const folderZ = f.isRecord
            ? stackFolderPaintZ(f.record!, items, stacks)
            : Math.min(...f.members.map((m) => m.zIndex)) - 1
          const countZ = f.isRecord
            ? stackCountPaintZ(f.record!, items, stacks)
            : Math.max(...f.members.map((m) => m.zIndex), 1) + 2
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
              )
            : null
          const folderChromeOp = folderScatter ? 1 : folderOp
          // Fan cards belonging to this stack — nested under StackUnit so drag moves as one
          const unitFans = stackPreviewItems.filter(
            (it) =>
              it.stackGroupId === f.gid &&
              !(
                it.stackGroupId != null &&
                parentPeerGhostStackIds.has(it.stackGroupId)
              ),
          )
          const unitFanOpacity = exitPeerStackPreviewOpacity(
            exitAfterHandoff,
            exitingStackId,
            f.gid,
            exitPeerOpacity,
          )
          // Live fan DOM only during morph involving this stack; else bitmap composite
          const forceLiveFans =
            !!(
              stackEnterAnim &&
              (stackEnterAnim.stackId === f.gid ||
                stacks.some(
                  (s) =>
                    s.id === f.gid && s.parentId === stackEnterAnim.stackId,
                ))
            ) || !!folderScatter
          const stackRec: import('../types/canvas').StackRecord =
            f.record ?? {
              id: f.gid,
              parentId: currentContainerId,
              name: f.name,
              x: f.bounds.x,
              y: f.bounds.y,
              width: f.bounds.width,
              height: f.bounds.height,
              zIndex: folderZ,
            }
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
            {peer.fanItems.map((item) => (
              <div
                key={`peer-ghost-fan-${item.id}`}
                className="stack-preview-wrap"
                style={{
                  opacity: 1,
                  pointerEvents: 'none',
                }}
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
        {/* Fan cards are nested under StackUnit with their folder (rigid drag unit). */}
        {sortedNonEmbeds.map((item) => {
          const peerOp = exitAfterHandoff ? exitPeerOpacity : 1
          // Exit stack: scribbles vanish quickly (not part of gather fan)
          const scribbleExitFade =
            item.type === 'scribble' &&
            stackEnterAnim?.mode === 'exit' &&
            (containerOf(item) === stackEnterAnim.stackId ||
              item.stackGroupId === stackEnterAnim.stackId)
              ? Math.max(0, 1 - Math.min(1, animProgress.t / 0.18))
              : 1
          const scattering =
            exitAfterHandoff && peerScatterOriginWorld != null
          const scatter = scattering
            ? peerScatterStyle(
                {
                  x: item.x + item.width / 2,
                  y: item.y + item.height / 2,
                },
                peerScatterOriginWorld,
                peerOp,
                item.id,
              )
            : { opacity: peerOp }
          const combinedOp =
            (typeof scatter.opacity === 'number' ? scatter.opacity : 1) *
            scribbleExitFade
          // Live free items must stay clickable; never use is-peer-ghost here.
          const scatterClass = scattering
            ? peerScatterWrapClassName({ isGhost: false })
            : ''
          const allowPointer =
            scribbleExitFade < 0.05
              ? false
              : freeItemWrapAllowsPointer(exitAfterHandoff, peerOp)
          return (
          <div
            key={item.id}
            className={`peer-fade-wrap${scatterClass ? ` ${scatterClass}` : ''}`}
            style={{
              ...scatter,
              opacity: combinedOp,
              // Explicit override so a stuck handoff style cannot brick selection
              pointerEvents: allowPointer ? 'auto' : 'none',
            }}
          >
            <CanvasItemView
              item={item}
              selected={selectedSet.has(item.id)}
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
        {allEmbedItems.map((item) => {
          let pose = resolveEmbedWorldPose(
            item,
            currentContainerId,
            stacks,
          )
          // Enter/exit: also show free embeds living on the parent (ghost)
          if (
            (exitGhostParent || enterGhostParent) &&
            animStackRec &&
            animParentId &&
            !pose.visible
          ) {
            const parentPose = resolveEmbedWorldPose(
              item,
              animParentId,
              stacks,
            )
            if (parentPose.visible) {
              pose = {
                ...parentPose,
                x: parentPose.x - animStackRec.x,
                y: parentPose.y - animStackRec.y,
              }
            }
          }
          const display = embedDisplayItem(item, pose)
          const isExitingFan =
            pose.asPreview && pose.stackGroupId === exitingStackId
          const isPeerGhostPreview =
            pose.asPreview &&
            pose.stackGroupId != null &&
            parentPeerGhostStackIds.has(pose.stackGroupId)
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
        })}
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
