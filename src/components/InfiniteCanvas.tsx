import { Fragment } from 'react'
import { useCanvasStore } from '../store/useCanvasStore'
import { CanvasItemView } from './items/CanvasItemView'
import { EmptyState } from './EmptyState'
import { StackFolder } from './StackFolder'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { collectItemsInStackTree, containerOf, countLeafItemsInStack, migrateLegacyStacks } from '../utils/stacks'
import { embedDisplayItem, resolveEmbedWorldPose } from '../utils/embedPose'
import { type GroupScaleHandle } from '../utils/selectionBounds'
import { exitPeerStackPreviewOpacity } from '../utils/stackNavigationAnimation'
import {
  captureJointMoveSelection,
  useInfiniteCanvasController,
} from '../hooks/useInfiniteCanvasController'

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
    viewport,
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
  } = useInfiniteCanvasController()

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
      <div
        className="canvas-world"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        <div className="canvas-grid" />
        {/* Folder chrome for nested stacks + legacy groups */}
        {stackFolders.map((f) => {
          // A persistent exit-peer layer below owns this stack until the fade
          // reaches 1. Avoid mounting a second real folder at handoff.
          if (exitParentPeerStackIds.has(f.gid)) return null
          // During exit settle, real folder fades in under morph overlay
          const exitAnim =
            stackEnterAnim?.mode === 'exit' &&
            stackEnterAnim.stackId === f.gid
              ? stackEnterAnim
              : null
          // Other stacks on parent fade in with exit settle (not the one we just left)
          const folderOpacity =
            exitAnim != null
              ? Math.max(0, Math.min(1, exitAnim.settle ?? 0))
              : exitAfterHandoff
                ? exitPeerOpacity
                : 1
          // Leaf items only (nested stack folders are not counted as items)
          const countN = countLeafItemsInStack(items, stacks, f.gid)
          const leafZ = collectItemsInStackTree(items, stacks, f.gid).map(
            (i) => i.zIndex,
          )
          // Folder chrome always under fan cards
          const folderZ =
            Math.min(f.z, ...(leafZ.length ? leafZ : [f.z + 1])) - 1
          const countZ = Math.max(f.z, ...leafZ, 1) + 2
          // Nested child stack chrome (B inside A): fade with enter/exit anim
          const childOfAnim =
            stackEnterAnim &&
            stacks.some(
              (s) =>
                s.id === f.gid && s.parentId === stackEnterAnim.stackId,
            )
          const nestedChrome =
            childOfAnim && stackEnterAnim
              ? Math.max(0, Math.min(1, stackEnterAnim.nestedChromeOpacity ?? 1))
              : 1
          const folderOp = folderOpacity * nestedChrome
          return (
          <Fragment key={`folder-wrap-${f.gid}`}>
          <StackFolder
            groupId={f.gid}
            members={f.members}
            bounds={f.bounds}
            selected={f.selected}
            dropTarget={f.dropTarget}
            zIndex={folderZ}
            name={f.name}
            styleOpacity={folderOp}
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
                opacity: folderOp,
                pointerEvents: 'none',
              }}
            >
              {countN}
            </span>
          )}
          </Fragment>
          )
        })}
        {/*
          Parent peers (enter fade-out / exit fade-in): continuous ghost layer
          so container switch never pops same-level items off instantly.
        */}
        {parentPeerGhostStacks.map((peer) => (
          <Fragment key={`peer-ghost-stack-${peer.stack.id}`}>
            <StackFolder
              groupId={peer.stack.id}
              members={[]}
              bounds={peer.bounds}
              selected={false}
              zIndex={peer.folderZ}
              name={peer.stack.name}
              styleOpacity={navPeerOpacity}
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
                  opacity: navPeerOpacity,
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
                  opacity: navPeerOpacity,
                  pointerEvents: 'none',
                }}
              >
                <CanvasItemView
                  item={item}
                  selected={false}
                  onPointerDown={() => {}}
                  onResizePointerDown={() => {}}
                />
              </div>
            ))}
          </Fragment>
        ))}
        {parentPeerGhostItems.map((item) => (
          <div
            key={`peer-ghost-item-${item.id}`}
            className="peer-fade-wrap"
            style={{
              opacity: navPeerOpacity,
              pointerEvents: 'none',
            }}
          >
            <CanvasItemView
              item={item}
              selected={false}
              onPointerDown={() => {}}
              onResizePointerDown={() => {}}
            />
          </div>
        ))}
        {stackPreviewItems.map((item) => {
          // Ghost layer owns peer-stack fan cards during enter/exit — hide real ones
          const isPeerGhostPreview =
            item.stackGroupId != null &&
            parentPeerGhostStackIds.has(item.stackGroupId)
          if (isPeerGhostPreview) return null
          // At exit handoff the real parent layer takes ownership at exactly the
          // ghost's current opacity. The stack we just left stays fully visible;
          // sibling stacks continue the same one-way reveal as ordinary items.
          const previewOpacity = exitPeerStackPreviewOpacity(
            exitAfterHandoff,
            exitingStackId,
            item.stackGroupId,
            exitPeerOpacity,
          )
          return (
            <div
              key={item.id}
              className="stack-preview-wrap"
              style={{ opacity: previewOpacity }}
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
        {sortedNonEmbeds.map((item) => (
          <div
            key={item.id}
            className="peer-fade-wrap"
            style={{
              opacity: exitAfterHandoff ? exitPeerOpacity : 1,
            }}
          >
            <CanvasItemView
              item={item}
              selected={selectedSet.has(item.id)}
              onPointerDown={onItemPointerDown}
              onResizePointerDown={onResizePointerDown}
            />
          </div>
        ))}
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
      </div>

      {visibleItems.length === 0 &&
        visibleStacks.length === 0 &&
        currentContainerId === ROOT_CONTAINER_ID && <EmptyState />}

      {/* Stack folder morph: screen-space outer rect, world-scale chrome (matches canvas zoom) */}
      {stackEnterAnim && (
        <div className="stack-enter-overlay" aria-hidden>
          {(() => {
            const t = stackEnterAnim.t
            const settle = stackEnterAnim.settle ?? 0
            const a = stackEnterAnim.start
            const vw = window.innerWidth
            const vh = window.innerHeight
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
             * Morph is a surface overlay — if we paint CSS px at screen size, chrome
             * looks larger whenever zoom < 1. Layout in world units then scale(zoom).
             */
            const zoom = Math.max(0.05, viewport.zoom)
            const worldW = w / zoom
            const worldH = h / zoom
            /*
             * Enter: expand + fade out together — fully transparent at full-screen edge.
             * Exit: fade in with shrink, then settle crossfades to real folder.
             */
            const smooth = (u: number) => u * u * (3 - 2 * u) // smoothstep
            const clamp01 = (u: number) => Math.max(0, Math.min(1, u))
            // Enter: hit full transparency slightly before t=1 so edge is clean
            const enterFade = clamp01(t / 0.92)
            const baseOp =
              stackEnterAnim.mode === 'exit'
                ? smooth(clamp01(t))
                : 1 - smooth(enterFade)
            const opacity =
              stackEnterAnim.mode === 'exit'
                ? baseOp * (1 - smooth(clamp01(settle)))
                : baseOp
            // Tab + count: enter rides parent opacity; exit trails body then settle-out
            const detailT =
              stackEnterAnim.mode === 'exit'
                ? clamp01((t - 0.08) / 0.92)

                : 1
            const detailOp =
              stackEnterAnim.mode === 'exit'
                ? smooth(detailT) * (1 - smooth(clamp01(settle)))
                : 1
            const hasName = !!(stackEnterAnim.name || '').trim()
            const count = stackEnterAnim.memberCount ?? 0
            return (
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
                {/* Body fill — height from top offset; parent opacity drives fade */}
                <div className="stack-folder-body" />
                {count > 0 && (
                  <span
                    className="stack-folder-label"
                    style={{ opacity: detailOp }}
                  >
                    {count}
                  </span>
                )}
              </div>
            )
          })()}
        </div>
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

      {snapGuides.map((g, i) => {
        if (g.orientation === 'v') {
          const sx = g.pos * viewport.zoom + viewport.x
          return <div key={`sg-${i}`} className="snap-guide v" style={{ left: sx }} />
        }
        const sy = g.pos * viewport.zoom + viewport.y
        return <div key={`sg-${i}`} className="snap-guide h" style={{ top: sy }} />
      })}

      {dropActive && (
        <div className="drop-overlay">Drop media, URL, or text</div>
      )}
    </div>
  )
}
