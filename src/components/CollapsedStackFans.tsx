/**
 * Collapsed stack fan: one composite bitmap when fully ready; live DOM until then.
 *
 * Stability rules:
 * - Never tear down a good bitmap because a sibling moved or surface z reflowed
 * - Never swap to a partial composite (no white slabs / reorder holes)
 * - Hold the last *decoded* bitmap until the next matching decode completes
 * - Live DOM only when forceLive (morph) or no decoded bitmap exists yet
 */

import {
  memo,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from 'react'
import type { CanvasItem, StackRecord } from '../types/canvas'
import { CanvasItemView } from './items/CanvasItemView'
import {
  ensureStackFanComposite,
  getStackFanComposite,
  sortFanItemsStable,
  stackFanContentKey,
  stackFanNeedsLiveText,
  type StackFanComposite,
} from '../utils/stackFanComposite'

/** Relative content signature — rank order, not absolute zIndex. */
function fanItemsSignature(
  fanItems: CanvasItem[],
  stackX: number,
  stackY: number,
): string {
  const ordered = sortFanItemsStable(fanItems)
  return ordered
    .map((f, rank) => {
      const src =
        f.type === 'image' ||
        f.type === 'gif' ||
        f.type === 'video' ||
        f.type === 'audio'
          ? f.src
          : f.type === 'link'
            ? f.image
            : ''
      const sp = f.stackPreview
      const crop =
        f.type === 'image' || f.type === 'gif' || f.type === 'video'
          ? f.crop
          : undefined
      const cropTag = crop
        ? `${crop.x}:${crop.y}:${crop.w}:${crop.h}`
        : ''
      let textTag = ''
      if (f.type === 'text') {
        textTag = `t:${f.content.slice(0, 48)}:${f.color ?? ''}:${f.backgroundColor ?? ''}`
      } else if (f.type === 'textcard') {
        textTag = `c:${f.content.slice(0, 48)}:${f.color ?? ''}:${f.backgroundColor ?? ''}`
      }
      return [
        f.id,
        rank,
        Math.round((sp?.x ?? f.x) - stackX),
        Math.round((sp?.y ?? f.y) - stackY),
        Math.round(f.width),
        Math.round(f.height),
        Math.round((sp?.rotation ?? f.rotation ?? 0) * 10),
        f.type,
        src?.length ?? 0,
        cropTag,
        textTag,
      ].join(':')
    })
    .join('|')
}

function CollapsedStackFansInner({
  stack,
  items,
  stacks,
  fanItems,
  opacity,
  selected,
  forceLive,
  zIndexBase,
}: {
  stack: StackRecord
  items: CanvasItem[]
  stacks: StackRecord[]
  fanItems: CanvasItem[]
  opacity: number
  selected: boolean
  forceLive: boolean
  zIndexBase: number
}) {
  const orderedFans = useMemo(
    () => sortFanItemsStable(fanItems),
    [fanItems],
  )
  const needsLiveText = stackFanNeedsLiveText(orderedFans)

  const contentSig = fanItemsSignature(orderedFans, stack.x, stack.y)

  const key = useMemo(
    () => stackFanContentKey(stack, items, stacks),
    // Absolute folder x/y and absolute leaf z must not invalidate
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stack.id, stack.width, stack.height, contentSig],
  )

  /**
   * pending: newest composite for current key (may still be decoding).
   * display: last fully decoded composite — always paint this until replaced
   * by a decoded match (prevents live-DOM flash on rebuild).
   */
  const [pending, setPending] = useState<StackFanComposite | null>(() =>
    getStackFanComposite(stack.id),
  )
  /** Last fully decoded composite — held across rebuilds to avoid live flash */
  const [display, setDisplay] = useState<StackFanComposite | null>(() =>
    getStackFanComposite(stack.id),
  )
  const [displayReady, setDisplayReady] = useState(() => !!getStackFanComposite(stack.id))

  // Promote pending → display only after browser has the pixels
  const promoteIfReady = (
    c: StackFanComposite,
    el?: HTMLImageElement | null,
  ) => {
    if (el && !(el.complete && el.naturalWidth > 0)) return false
    setDisplay(c)
    setDisplayReady(true)
    return true
  }

  // Pull from cache when key already published
  useEffect(() => {
    const c = getStackFanComposite(stack.id)
    if (c && c.key === key) {
      setPending(c)
    }
  }, [key, stack.id])

  // Build when content key changes (not on sibling move / z reflow)
  useEffect(() => {
    if (orderedFans.length === 0 || needsLiveText) return
    const cached = getStackFanComposite(stack.id)
    if (cached && cached.key === key) {
      setPending(cached)
      return
    }
    let cancelled = false
    void ensureStackFanComposite(stack, items, stacks).then((c) => {
      if (cancelled || !c || c.key !== key) return
      setPending(c)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, needsLiveText, stack.id, orderedFans.length])

  const displayOk =
    !forceLive &&
    !needsLiveText &&
    !!display &&
    displayReady &&
    orderedFans.length > 0

  // Live only when morph forces it, or we have *no* holdover bitmap at all.
  // Never tear down a previous composite for a key rebuild (handoff flash).
  const showLive =
    orderedFans.length > 0 &&
    (forceLive || needsLiveText || (!display && !displayReady))

  const compositeZ = useMemo(() => {
    let z = zIndexBase
    for (const f of orderedFans) {
      if (f.zIndex > z) z = f.zIndex
    }
    return z
  }, [orderedFans, zIndexBase])

  // Decode pending when it differs from what's on screen (or nothing displayed yet)
  const loadTarget =
    !needsLiveText &&
    pending &&
    (!display || pending.url !== display.url || !displayReady)
      ? pending
      : null

  return (
    <>
      {showLive &&
        orderedFans.map((item) => (
          <div
            key={item.id}
            className="stack-preview-wrap"
            style={{
              opacity,
              pointerEvents: 'none',
            }}
          >
            <CanvasItemView
              item={item}
              selected={selected}
              staticPreview
              onPointerDown={() => {}}
              onResizePointerDown={() => {}}
            />
          </div>
        ))}

      {/* Hidden decode of next composite — promote only when fully ready */}
      {loadTarget && (
        <img
          key={`load-${loadTarget.url}`}
          src={loadTarget.url}
          alt=""
          draggable={false}
          decoding="async"
          ref={(el) => {
            if (el && el.complete && el.naturalWidth > 0) {
              queueMicrotask(() => promoteIfReady(loadTarget, el))
            }
          }}
          onLoad={(e) => promoteIfReady(loadTarget, e.currentTarget)}
          onError={() => {
            setPending((p) => (p?.url === loadTarget.url ? null : p))
          }}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
            visibility: 'hidden',
          }}
        />
      )}

      {/* Visible composite — last decoded, held across key rebuilds */}
      {!needsLiveText && display && orderedFans.length > 0 && (
        <img
          key={`show-${display.url}`}
          className="stack-fan-composite"
          src={display.url}
          alt=""
          draggable={false}
          decoding="sync"
          onError={() => {
            setDisplayReady(false)
            setDisplay(null)
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: display.width,
            height: display.height,
            transform: `translate(${stack.x + display.relX}px, ${
              stack.y + display.relY
            }px)`,
            transformOrigin: 'top left',
            zIndex: compositeZ,
            opacity: displayOk ? opacity : 0,
            pointerEvents: 'none',
            userSelect: 'none',
            visibility: displayOk ? 'visible' : 'hidden',
          }}
        />
      )}
    </>
  )
}

function propsEqual(
  a: ComponentProps<typeof CollapsedStackFansInner>,
  b: ComponentProps<typeof CollapsedStackFansInner>,
): boolean {
  if (a.forceLive !== b.forceLive) return false
  if (a.opacity !== b.opacity) return false
  if (a.selected !== b.selected) return false
  if (a.zIndexBase !== b.zIndexBase) return false
  if (a.stack.id !== b.stack.id) return false
  if (a.stack.x !== b.stack.x || a.stack.y !== b.stack.y) return false
  if (a.stack.width !== b.stack.width || a.stack.height !== b.stack.height)
    return false
  if (a.fanItems.length !== b.fanItems.length) return false
  for (let i = 0; i < a.fanItems.length; i++) {
    const x = a.fanItems[i]
    const y = b.fanItems[i]
    if (x.id !== y.id) return false
    // Absolute z reflow still needs re-render so composite stacks above free items
    if (x.zIndex !== y.zIndex) return false
    if ((x.rotation || 0) !== (y.rotation || 0)) return false
    if (x.width !== y.width || x.height !== y.height) return false
    const xs = x.stackPreview
    const ys = y.stackPreview
    if (xs && ys) {
      if (
        Math.round(xs.x - a.stack.x) !== Math.round(ys.x - b.stack.x) ||
        Math.round(xs.y - a.stack.y) !== Math.round(ys.y - b.stack.y) ||
        (xs.rotation || 0) !== (ys.rotation || 0)
      )
        return false
    } else if (xs !== ys) return false
    if ('src' in x && 'src' in y && x.src !== y.src) return false
    if (x.type === 'text' && y.type === 'text') {
      if (
        x.content !== y.content ||
        x.color !== y.color ||
        x.backgroundColor !== y.backgroundColor
      )
        return false
    }
    if (x.type === 'textcard' && y.type === 'textcard') {
      if (
        x.content !== y.content ||
        x.color !== y.color ||
        x.backgroundColor !== y.backgroundColor
      )
        return false
    }
    if (
      (x.type === 'image' || x.type === 'gif' || x.type === 'video') &&
      (y.type === 'image' || y.type === 'gif' || y.type === 'video')
    ) {
      const xc = x.crop
      const yc = y.crop
      if (xc || yc) {
        if (
          (xc?.x ?? 0) !== (yc?.x ?? 0) ||
          (xc?.y ?? 0) !== (yc?.y ?? 0) ||
          (xc?.w ?? 1) !== (yc?.w ?? 1) ||
          (xc?.h ?? 1) !== (yc?.h ?? 1)
        )
          return false
      }
    }
  }
  return true
}

export const CollapsedStackFans = memo(CollapsedStackFansInner, propsEqual)
