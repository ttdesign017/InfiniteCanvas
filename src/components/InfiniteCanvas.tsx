import type { CSSProperties, ReactNode } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import type { StackEnterAnim } from '../store/types'
import { CanvasItemView } from './items/CanvasItemView'
import { EmptyState } from './EmptyState'
import { StackFolder } from './StackFolder'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { containerOf, countLeafItemsInStack, migrateLegacyStacks } from '../utils/stacks'
import { embedDisplayItem, resolveEmbedWorldPose } from '../utils/embedPose'
import { type GroupScaleHandle } from '../utils/selectionBounds'
import { exitPeerStackPreviewOpacity } from '../utils/stackNavigationAnimation'
import {
  useStackAnimProgress,
  type StackAnimProgress,
} from '../utils/stackAnimProgress'
import type { SnapGuide } from '../utils/snap'
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
  return (
    <div
      className="canvas-world"
      style={
        {
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})`,
          // Counter-scale selection chrome so corner handles stay constant on screen
          '--canvas-zoom': String(zoom),
        } as CSSProperties
      }
    >
      {children}
    </div>
  )
}

function SnapGuidesLayer({ guides }: { guides: SnapGuide[] }) {
  const viewport = useCanvasStore((s) => s.viewport)
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
    snapGuides,
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
    animStackRec,
    animParentId,
    exitingStackId,
    exitGhostParent,
    enterGhostParent,
    exitPeerOpacity,
    exitAfterHandoff,
    parentPeerGhostItems,
    parentPeerGhostStacks,
    parentPeerGhostStackIds,
    exitParentPeerStackIds,
    navPeerOpacity,
    peerScatterOriginLocal,
    peerScatterOriginWorld,
  } = useInfiniteCanvasController()

  // Morph progress (t / settle / nested chrome) — not in Zustand hot path
  const animProgress = useStackAnimProgress()

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
          return (
          <div
            key={`folder-wrap-${f.gid}`}
            className={
              folderScatter
                ? peerScatterWrapClassName({ isGhost: false })
                : undefined
            }
            style={folderScatter ?? undefined}
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
          {/* Count above fan cards — same anchor as .stack-folder-label (right:12 bottom:10) */}
          {countN > 0 && folderOp > 0.05 && (
            <span
              className="stack-folder-label stack-count-float"
              style={{
                // Bottom-right of badge at folder corner inset (matches morph chrome)
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
          </div>
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
        {stackPreviewItems.map((item) => {
          // Ghost layer owns peer-stack fan cards during enter/exit — hide real ones
          const isPeerGhostPreview =
            item.stackGroupId != null &&
            parentPeerGhostStackIds.has(item.stackGroupId)
          if (isPeerGhostPreview) return null
          // At exit handoff the real parent layer takes ownership at exactly the
          // ghost's current opacity + scatter. Exiting stack fan stays solid at rest.
          const previewOpacity = exitPeerStackPreviewOpacity(
            exitAfterHandoff,
            exitingStackId,
            item.stackGroupId,
            exitPeerOpacity,
          )
          const isSiblingPeer =
            exitAfterHandoff &&
            item.stackGroupId != null &&
            item.stackGroupId !== exitingStackId
          // Rigid unit: same scatter as folder (unit center), not per-card center —
          // matches ghost wrap so handoff does not pop fan vs chrome.
          const siblingRec =
            isSiblingPeer && item.stackGroupId
              ? stacks.find((s) => s.id === item.stackGroupId)
              : null
          const scatter =
            isSiblingPeer &&
            peerScatterOriginWorld != null &&
            siblingRec != null
              ? peerScatterStyle(
                  {
                    x: siblingRec.x + siblingRec.width / 2,
                    y: siblingRec.y + siblingRec.height / 2,
                  },
                  peerScatterOriginWorld,
                  previewOpacity,
                  siblingRec.id,
                )
              : { opacity: previewOpacity }
          return (
            <div
              key={item.id}
              className={`stack-preview-wrap${
                isSiblingPeer
                  ? ` ${peerScatterWrapClassName({ isGhost: false })}`
                  : ''
              }`}
              style={scatter}
            >
              <CanvasItemView
                item={item}
                selected={
                  !!(
                    item.stackGroupId &&
                    selectedStackSet.has(item.stackGroupId)
                  )
                }
                onPointerDown={(e, it) => {
                  // Stacked previews use pointer-events:none — hits go to folder.
                  // Keep handler for legacy paths / safety.
                  if (e.button !== 0) return
                  const gid = it.stackGroupId
                  if (!gid) return
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

                  if (e.detail >= 2) {
                    const vp = store.viewport
                    const folder = store.stacks.find((s) => s.id === gid)
                    if (folder) {
                      store.enterStack(gid, {
                        x: folder.x * vp.zoom + vp.x,
                        y: folder.y * vp.zoom + vp.y,
                        w: folder.width * vp.zoom,
                        h: folder.height * vp.zoom,
                      })
                    }
                    return
                  }

                  const additive = e.shiftKey || e.ctrlKey || e.metaKey
                  if (additive) store.selectStacks([gid], true)
                  else if (!store.selectedStackIds.includes(gid)) {
                    store.selectStacks([gid])
                  }
                  const joint = captureJointMoveSelection(
                    useCanvasStore.getState(),
                  )
                  if (!joint.stackIds.includes(gid)) {
                    joint.stackIds = [...joint.stackIds, gid]
                    const st = store.stacks.find((s) => s.id === gid)
                    if (st) joint.stackOrigins[gid] = { x: st.x, y: st.y }
                  }
                  dragRef.current = {
                    kind: 'pending-move',
                    itemId: gid,
                    isStacked: true,
                    stackGroupId: gid,
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
                onResizePointerDown={() => {
                  /* previews are not resizable */
                }}
              />
            </div>
          )
        })}
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
          <div
            className="group-selection-box"
            style={{
              transform: `translate(${groupBounds.x}px, ${groupBounds.y}px)`,
              width: groupBounds.width,
              height: groupBounds.height,
              zIndex: 100000,
              // Hold C for crop: let events pass through to canvas surface
              pointerEvents: cHeld ? 'none' : 'auto',
            }}
            onPointerDown={(e) => {
              // Drag the group by grabbing the box fill (not corners/edges)
              if (e.button !== 0) return
              const store = useCanvasStore.getState()
              // Never steal crop / pan gestures
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
              dragRef.current = {
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
      {stackEnterAnim && (
        <StackMorphOverlay
          stackEnterAnim={stackEnterAnim}
          progress={animProgress}
        />
      )}

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

      <SnapGuidesLayer guides={snapGuides} />

      {dropActive && (
        <div className="drop-overlay">Drop media, URL, or text</div>
      )}
    </div>
  )
}

/** Screen-space folder morph; reads zoom only (viewport slice) + progress bus. */
function StackMorphOverlay({
  stackEnterAnim,
  progress,
}: {
  stackEnterAnim: StackEnterAnim
  progress: StackAnimProgress
}) {
  const zoom = useCanvasStore((s) => Math.max(0.05, s.viewport.zoom))
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
