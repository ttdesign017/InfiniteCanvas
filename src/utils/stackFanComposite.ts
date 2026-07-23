/**
 * Rasterize a collapsed stack's fan into one bitmap for parent-canvas paint.
 *
 * Rules:
 * - Stack-local space (folder drag must not rebuild)
 * - Match live stacked look: bottom-left origin, 10px radius, dual soft shadow
 * - ALL painted media must fully decode — never publish a partial / white slab
 * - Content key ignores absolute zIndex (select/drag reflow must not rebuild)
 * - Plain text keeps transparent face (no opaque white slab over the pile)
 */

import type {
  CanvasItem,
  CropRect,
  MediaItem,
  StackRecord,
  TextCardItem,
  TextItem,
} from '../types/canvas'
import { FULL_CROP, getCrop } from './crop'
import { getVideoPoster, ensureVideoPoster } from './videoPosterCache'
import { collapsedStackFanCards } from './stacks'
import { trackBlobUrl, revokeBlobUrl } from './blobUrls'
import {
  STACK_FAN_EDGE_ALPHA,
  STACK_FAN_RADIUS_PX,
  STACK_FAN_SHADOW,
} from './stackFanChrome'

export type StackFanComposite = {
  stackId: string
  key: string
  relX: number
  relY: number
  width: number
  height: number
  url: string
}

const cache = new Map<string, StackFanComposite>()
/** Inflight keyed by stackId + content key so stale jobs cannot clobber */
const inflight = new Map<string, Promise<StackFanComposite | null>>()
/** Retry timers when decode fails (all-or-nothing) */
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const MAX_EDGE = 2048
const CARD_RADIUS = STACK_FAN_RADIUS_PX
const SHADOW_PAD = 40
const LOAD_ATTEMPTS = 5

function mediaSrc(item: CanvasItem): string | null {
  if (
    item.type === 'image' ||
    item.type === 'gif' ||
    item.type === 'video' ||
    item.type === 'audio'
  ) {
    return item.src || null
  }
  if (item.type === 'link') return item.image || null
  return null
}

function isPaintedMedia(item: CanvasItem): boolean {
  return (
    item.type === 'image' ||
    item.type === 'gif' ||
    item.type === 'video' ||
    item.type === 'link'
  )
}

function cropTag(item: CanvasItem): string {
  if (
    item.type !== 'image' &&
    item.type !== 'gif' &&
    item.type !== 'video'
  ) {
    return ''
  }
  const c = getCrop(item as MediaItem)
  if (c.w >= 0.999 && c.h >= 0.999 && c.x <= 0.001 && c.y <= 0.001) return ''
  return `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.w.toFixed(3)},${c.h.toFixed(3)}`
}

/**
 * Content key: relative fan geometry + media/text identity only.
 * Dragging the folder must not change this.
 * Absolute zIndex is intentionally omitted — select/drag reflowContainerSurfaceZ
 * rewrites surface z every click and must not invalidate the composite.
 * Relative paint order is encoded by sort position (rank), not raw z values.
 */
export function stackFanContentKey(
  stack: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
): string {
  const cards = collapsedStackFanCards(stack, items, stacks)
  const itemById = new Map(items.map((i) => [i.id, i]))
  // Stable order: z then id — matches paint + live DOM sort
  const ordered = [...cards].sort(
    (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
  )
  const parts = ordered.map((c, rank) => {
    const m = itemById.get(c.id)
    const src = m ? mediaSrc(m) : null
    const srcTag = src
      ? `${src.length}:${src.slice(0, 24)}:${src.slice(-12)}`
      : ''
    const rx = Math.round(c.x - stack.x)
    const ry = Math.round(c.y - stack.y)
    let textTag = ''
    if (m?.type === 'text') {
      const t = m as TextItem
      textTag = `t:${String(t.content).slice(0, 48)}:${t.color ?? ''}:${t.backgroundColor ?? ''}:${t.fontSize ?? 0}`
    } else if (m?.type === 'textcard') {
      const t = m as TextCardItem
      textTag = `c:${String(t.content).slice(0, 48)}:${t.color ?? ''}:${t.backgroundColor ?? ''}:${t.fontSize ?? 0}`
    }
    return [
      c.id,
      rank,
      rx,
      ry,
      Math.round(c.width),
      Math.round(c.height),
      Math.round((c.rotation || 0) * 10),
      m?.type ?? '',
      srcTag,
      m && 'flipX' in m && m.flipX ? 1 : 0,
      m && 'flipY' in m && m.flipY ? 1 : 0,
      m ? cropTag(m) : '',
      textTag,
    ].join(',')
  })
  return [
    stack.id,
    Math.round(stack.width),
    Math.round(stack.height),
    // v9: shadows/edge match stackFanChrome (live CSS) for seamless handoff
    'v9',
    parts.join('|'),
  ].join(';')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Strict load: natural size > 0 + optional decode. Retries on failure. */
async function loadImageStrict(
  src: string,
  attempts = LOAD_ATTEMPTS,
): Promise<HTMLImageElement> {
  let lastReason = 'unknown'
  for (let i = 0; i < attempts; i++) {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image()
      if (/^https?:/i.test(src)) {
        try {
          el.crossOrigin = 'anonymous'
        } catch {
          /* ignore */
        }
      }
      el.decoding = 'async'
      let settled = false
      const done = (v: HTMLImageElement | null) => {
        if (settled) return
        settled = true
        resolve(v)
      }
      el.onload = () => done(el)
      el.onerror = () => done(null)
      try {
        el.src = src
      } catch {
        done(null)
      }
    })
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      if (typeof img.decode === 'function') {
        try {
          await img.decode()
        } catch {
          /* natural dims ok — still usable */
        }
      }
      return img
    }
    lastReason = img ? 'zero-size' : 'error'
    await sleep(60 * (i + 1) + Math.floor(Math.random() * 40))
  }
  throw new Error(`media decode failed (${lastReason}): ${src.slice(0, 48)}`)
}

async function resolvePaintSrc(item: CanvasItem): Promise<string> {
  if (item.type === 'video') {
    let poster = getVideoPoster(item.id, item.src)
    if (!poster && item.src) {
      poster = await ensureVideoPoster(item.id, item.src)
    }
    if (!poster) {
      throw new Error(`video poster missing: ${item.id}`)
    }
    return poster
  }
  const src = mediaSrc(item)
  if (!src) throw new Error(`media src missing: ${item.id}`)
  return src
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string[] {
  const raw = text.replace(/\s+/g, ' ').trim()
  if (!raw) return []
  const words = raw.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w
    if (ctx.measureText(trial).width <= maxW) cur = trial
    else {
      if (cur) lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function drawCroppedMedia(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  crop: CropRect,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const sx = Math.max(0, crop.x * nw)
  const sy = Math.max(0, crop.y * nh)
  const sw = Math.max(1, crop.w * nw)
  const sh = Math.max(1, crop.h * nh)
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

/**
 * CSS stacked card chrome — see stackFanChrome.ts (live DOM uses the same numbers).
 * Media path REQUIRES a decoded image — never fill a white slab for media.
 */
function isTransparentFill(fill?: string): boolean {
  if (!fill) return true
  const s = fill.trim().toLowerCase()
  return (
    s === 'transparent' ||
    s === 'rgba(0,0,0,0)' ||
    s === 'rgba(0, 0, 0, 0)' ||
    s === '#0000' ||
    s === '#00000000'
  )
}

function paintStackedCard(
  ctx: CanvasRenderingContext2D,
  opts: {
    blx: number
    bly: number
    w: number
    h: number
    rotationDeg: number
    radius: number
    img: HTMLImageElement | null
    crop?: CropRect
    flipX: boolean
    flipY: boolean
    fillStyle?: string
    label?: string
    labelColor?: string
    /** When true, image is required; white-only face is forbidden */
    requireMedia: boolean
    /**
     * Plain free-text: transparent face + glyphs only (no white slab).
     * Text cards / notes keep an opaque face.
     */
    transparentFace?: boolean
  },
) {
  const { blx, bly, w, h, rotationDeg, radius, img, flipX, flipY } = opts
  if (opts.requireMedia && !img) {
    throw new Error('paintStackedCard: media required but img is null')
  }

  ctx.save()
  ctx.translate(blx, bly)
  ctx.rotate((rotationDeg * Math.PI) / 180)

  // Media always has an opaque face (image covers the caster). Only plain
  // free-text may skip shadow+stroke. Do not treat missing fillStyle as
  // transparent when requireMedia — that dropped dual shadow + hairline
  // after handoff when live DOM swaps to the composite bitmap.
  const transparentFace =
    !opts.requireMedia &&
    (!!opts.transparentFace || isTransparentFill(opts.fillStyle))
  // Shadow casters: light fill only (black under-media left dark AA fringe).
  // Blur/offset match CSS dual box-shadow exactly (stackFanChrome).
  if (!transparentFace) {
    const shadowFill = opts.fillStyle || '#ffffff'
    const s1 = STACK_FAN_SHADOW.far
    const s2 = STACK_FAN_SHADOW.near
    // Scale shadow with card scale so downsampled composites keep relative depth
    const shadowScale = Math.max(0.35, Math.min(1, radius / CARD_RADIUS || 1))

    ctx.save()
    ctx.shadowColor = s1.color
    ctx.shadowBlur = s1.blur * shadowScale
    ctx.shadowOffsetY = s1.offsetY * shadowScale
    roundedRectPath(ctx, 0, -h, w, h, radius)
    ctx.fillStyle = shadowFill
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.shadowColor = s2.color
    ctx.shadowBlur = s2.blur * shadowScale
    ctx.shadowOffsetY = s2.offsetY * shadowScale
    roundedRectPath(ctx, 0, -h, w, h, radius)
    ctx.fillStyle = shadowFill
    ctx.fill()
    ctx.restore()
  }

  // Face
  ctx.save()
  roundedRectPath(ctx, 0, -h, w, h, radius)
  ctx.clip()
  if (img) {
    // Cover residual shadow fill completely with media pixels
    ctx.save()
    if (flipX || flipY) {
      ctx.translate(w / 2, -h / 2)
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1)
      ctx.translate(-w / 2, h / 2)
    }
    drawCroppedMedia(ctx, img, opts.crop ?? FULL_CROP, 0, -h, w, h)
    ctx.restore()
  } else if (opts.label != null) {
    if (!transparentFace) {
      ctx.fillStyle = opts.fillStyle || '#ffffff'
      ctx.fillRect(0, -h, w, h)
    }
    const label = opts.label.trim()
    if (label) {
      const fontPx = Math.max(
        11,
        Math.min(28, Math.round(Math.min(h * 0.14, w * 0.08))),
      )
      ctx.font = `500 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`
      ctx.textBaseline = 'top'
      const pad = Math.max(6, Math.min(14, w * 0.06))
      const lines = wrapText(ctx, label, w - pad * 2).slice(
        0,
        Math.max(1, Math.floor((h - pad * 2) / (fontPx * 1.35))),
      )
      let ty = -h + pad
      const lineH = fontPx * 1.35
      for (const line of lines) {
        // Soft shadow so glyphs stay legible over busy media under them
        ctx.fillStyle = 'rgba(0,0,0,0.22)'
        ctx.fillText(line, pad + 0.6, ty + 0.8, w - pad * 2)
        ctx.fillStyle = opts.labelColor || '#1e1e1e'
        ctx.fillText(line, pad, ty, w - pad * 2)
        ty += lineH
      }
    }
  }
  ctx.restore()

  // Light gray-white hairline — same alpha as live --stack-fan-edge-opacity final
  if (!transparentFace) {
    ctx.save()
    roundedRectPath(
      ctx,
      0.5,
      -h + 0.5,
      Math.max(0, w - 1),
      Math.max(0, h - 1),
      Math.max(0, radius - 0.5),
    )
    ctx.strokeStyle = `rgba(255, 255, 255, ${STACK_FAN_EDGE_ALPHA})`
    ctx.lineWidth = Math.max(1, 1.25 * (radius / CARD_RADIUS || 1))
    ctx.stroke()
    ctx.restore()
  }

  ctx.restore()
}

function inflightKey(stackId: string, contentKey: string) {
  return `${stackId}::${contentKey}`
}

function clearRetry(stackId: string) {
  const t = retryTimers.get(stackId)
  if (t) {
    clearTimeout(t)
    retryTimers.delete(stackId)
  }
}

function scheduleRetry(
  stackId: string,
  stack: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
  attempt: number,
) {
  clearRetry(stackId)
  const delay = Math.min(4000, 200 * Math.pow(1.6, attempt))
  const t = setTimeout(() => {
    retryTimers.delete(stackId)
    void ensureStackFanComposite(stack, items, stacks, attempt + 1)
  }, delay)
  retryTimers.set(stackId, t)
}

/**
 * Build (or return cached) fan composite for a collapsed stack.
 * Returns null while media is still loading — caller must keep live fans.
 */
export async function ensureStackFanComposite(
  stack: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
  attempt = 0,
): Promise<StackFanComposite | null> {
  const key = stackFanContentKey(stack, items, stacks)
  const hit = cache.get(stack.id)
  if (hit && hit.key === key) {
    clearRetry(stack.id)
    return hit
  }

  const ik = inflightKey(stack.id, key)
  const existing = inflight.get(ik)
  if (existing) return existing

  const job = (async (): Promise<StackFanComposite | null> => {
    const again = cache.get(stack.id)
    if (again && again.key === key) return again

    const cards = collapsedStackFanCards(stack, items, stacks)
    if (cards.length === 0) {
      // Keep previous good bitmap if any — do not wipe on empty transient
      return cache.get(stack.id) ?? null
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const c of cards) {
      const lx = c.x - stack.x
      const ly = c.y - stack.y
      const pad = Math.max(c.width, c.height) * 0.25 + SHADOW_PAD
      minX = Math.min(minX, lx - pad)
      minY = Math.min(minY, ly - pad)
      maxX = Math.max(maxX, lx + c.width + pad)
      maxY = Math.max(maxY, ly + c.height + pad)
    }
    minX = Math.min(minX, 0)
    minY = Math.min(minY, 0)
    maxX = Math.max(maxX, stack.width)
    maxY = Math.max(maxY, stack.height)

    const localW = Math.max(1, maxX - minX)
    const localH = Math.max(1, maxY - minY)
    const scale = Math.min(1, MAX_EDGE / Math.max(localW, localH))
    const cw = Math.max(1, Math.round(localW * scale))
    const ch = Math.max(1, Math.round(localH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      scheduleRetry(stack.id, stack, items, stacks, attempt)
      return cache.get(stack.id)?.key === key
        ? (cache.get(stack.id) ?? null)
        : null
    }
    ctx.clearRect(0, 0, cw, ch)

    const itemById = new Map(items.map((i) => [i.id, i]))
    // Stable paint order matches live fan (zIndex, then id)
    const sorted = [...cards].sort(
      (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
    )

    // Phase 1: resolve + decode ALL media first. Any failure → abort (no partial).
    type Prepared =
      | {
          kind: 'media'
          c: (typeof sorted)[number]
          img: HTMLImageElement
          flipX: boolean
          flipY: boolean
          crop: CropRect
        }
      | {
          kind: 'label'
          c: (typeof sorted)[number]
          fillStyle: string
          label: string
          labelColor: string
          transparentFace: boolean
        }

    const prepared: Prepared[] = []
    try {
      for (const c of sorted) {
        const m = itemById.get(c.id)
        if (!m) continue

        if (isPaintedMedia(m)) {
          const src = await resolvePaintSrc(m)
          const img = await loadImageStrict(src)
          prepared.push({
            kind: 'media',
            c,
            img,
            flipX: !!(m as MediaItem).flipX,
            flipY: !!(m as MediaItem).flipY,
            crop:
              m.type === 'image' || m.type === 'gif' || m.type === 'video'
                ? getCrop(m as MediaItem)
                : FULL_CROP,
          })
          continue
        }

        if (m.type === 'text') {
          const bg = m.backgroundColor || 'transparent'
          prepared.push({
            kind: 'label',
            c,
            fillStyle: bg,
            label: m.content,
            labelColor: m.color || '#1e1e1e',
            transparentFace: isTransparentFill(bg),
          })
        } else if (m.type === 'textcard') {
          prepared.push({
            kind: 'label',
            c,
            fillStyle: m.backgroundColor || '#ffffff',
            label: m.content,
            labelColor: m.color || '#1e1e1e',
            transparentFace: false,
          })
        }
        // scribble / audio / embed: not in fan
      }
    } catch {
      // Media decode failure is not allowed on the published bitmap.
      // Keep live fans; retry. Never write a partial white-slab composite.
      scheduleRetry(stack.id, stack, items, stacks, attempt)
      const prev = cache.get(stack.id)
      return prev && prev.key === key ? prev : null
    }

    if (prepared.length === 0) {
      return cache.get(stack.id) ?? null
    }

    // Phase 2: paint only after every media card decoded
    for (const p of prepared) {
      const c = p.c
      const lx = c.x - stack.x
      const ly = c.y - stack.y
      const blx = (lx - minX) * scale
      const bly = (ly + c.height - minY) * scale
      const dw = Math.max(1, c.width * scale)
      const dh = Math.max(1, c.height * scale)
      const radius = CARD_RADIUS * scale

      if (p.kind === 'media') {
        paintStackedCard(ctx, {
          blx,
          bly,
          w: dw,
          h: dh,
          rotationDeg: c.rotation || 0,
          radius,
          img: p.img,
          crop: p.crop,
          flipX: p.flipX,
          flipY: p.flipY,
          requireMedia: true,
        })
      } else {
        paintStackedCard(ctx, {
          blx,
          bly,
          w: dw,
          h: dh,
          rotationDeg: c.rotation || 0,
          radius,
          img: null,
          flipX: false,
          flipY: false,
          fillStyle: p.fillStyle,
          label: p.label,
          labelColor: p.labelColor,
          requireMedia: false,
          transparentFace: p.transparentFace,
        })
      }
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), 'image/png')
      } catch {
        resolve(null)
      }
    })
    if (!blob) {
      scheduleRetry(stack.id, stack, items, stacks, attempt)
      const prev = cache.get(stack.id)
      return prev && prev.key === key ? prev : null
    }

    const latestKey = stackFanContentKey(stack, items, stacks)
    if (latestKey !== key) {
      // Content moved under us — do not publish stale
      return cache.get(stack.id) ?? null
    }

    // Verify the PNG itself decodes before publishing (no blank white blob)
    const verifyUrl = URL.createObjectURL(blob)
    try {
      await loadImageStrict(verifyUrl, 2)
    } catch {
      URL.revokeObjectURL(verifyUrl)
      scheduleRetry(stack.id, stack, items, stacks, attempt)
      const prev = cache.get(stack.id)
      return prev && prev.key === key ? prev : null
    }
    URL.revokeObjectURL(verifyUrl)

    clearRetry(stack.id)
    return finalize(stack.id, key, minX, minY, localW, localH, blob)
  })().finally(() => {
    inflight.delete(ik)
  })

  inflight.set(ik, job)
  return job
}

function finalize(
  stackId: string,
  key: string,
  relX: number,
  relY: number,
  width: number,
  height: number,
  blob: Blob,
): StackFanComposite {
  const prev = cache.get(stackId)
  if (prev && prev.key === key) return prev
  const url = trackBlobUrl(URL.createObjectURL(blob))
  const entry: StackFanComposite = {
    stackId,
    key,
    relX,
    relY,
    width,
    height,
    url,
  }
  cache.set(stackId, entry)
  // Grace period so CollapsedStackFans can hold the previous decoded bitmap
  // until the new one finishes <img> decode (z-reflow / content rebuild).
  if (prev && prev.url !== url) {
    const old = prev.url
    setTimeout(() => revokeBlobUrl(old), 4000)
  }
  return entry
}

export function getStackFanComposite(stackId: string): StackFanComposite | null {
  return cache.get(stackId) ?? null
}

export function dropStackFanComposite(stackId: string): void {
  clearRetry(stackId)
  const prev = cache.get(stackId)
  if (prev) {
    revokeBlobUrl(prev.url)
    cache.delete(stackId)
  }
  for (const k of [...inflight.keys()]) {
    if (k.startsWith(`${stackId}::`)) inflight.delete(k)
  }
}

export function clearAllStackFanComposites(): void {
  for (const id of [...cache.keys()]) dropStackFanComposite(id)
  for (const t of retryTimers.values()) clearTimeout(t)
  retryTimers.clear()
}

export function stackFanCompositeCacheSize(): number {
  return cache.size
}

/** Stable sort for live fan DOM — must match composite paint order. */
export function sortFanItemsStable<T extends { id: string; zIndex: number }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
  )
}
