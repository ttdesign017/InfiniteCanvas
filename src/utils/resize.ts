export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** scale = media/text edges (uniform). edge = note/link (single side only). */
export type EdgeResizeMode = 'scale' | 'edge'

const MIN = 24
const MIN_CARD = 60

/**
 * Resize with fixed anchors.
 * - Corners: opposite corner fixed; optional aspect lock
 * - Edges + scale: uniform scale from opposite midpoint
 * - Edges + edge: ONLY that side moves (width XOR height)
 */
export function computeResize(
  handle: string,
  orig: Rect,
  dx: number,
  dy: number,
  keepAspect: boolean,
  edgeMode: EdgeResizeMode = 'scale',
): Rect {
  const aspect = orig.width / Math.max(1e-6, orig.height)
  const right = orig.x + orig.width
  const bottom = orig.y + orig.height
  const midX = orig.x + orig.width / 2
  const midY = orig.y + orig.height / 2
  const minSize = edgeMode === 'edge' ? MIN_CARD : MIN

  // Normalize handle
  const h = (handle || 'se').toLowerCase()

  // ── Single-edge card mode (note / link) ──────────────────────────
  if (edgeMode === 'edge' && h.length === 1) {
    switch (h) {
      case 'e':
        return {
          x: orig.x,
          y: orig.y,
          width: Math.max(minSize, orig.width + dx),
          height: orig.height,
        }
      case 'w': {
        const width = Math.max(minSize, orig.width - dx)
        return { x: right - width, y: orig.y, width, height: orig.height }
      }
      case 's':
        return {
          x: orig.x,
          y: orig.y,
          width: orig.width,
          height: Math.max(minSize, orig.height + dy),
        }
      case 'n': {
        const height = Math.max(minSize, orig.height - dy)
        return { x: orig.x, y: bottom - height, width: orig.width, height }
      }
      default:
        break
    }
  }

  // ── Corners (and scale-mode edges) ───────────────────────────────
  let x = orig.x
  let y = orig.y
  let width = orig.width
  let height = orig.height

  switch (h) {
    case 'se': {
      width = Math.max(minSize, orig.width + dx)
      height = keepAspect ? width / aspect : Math.max(minSize, orig.height + dy)
      if (keepAspect && Math.abs(dy) > Math.abs(dx)) {
        height = Math.max(minSize, orig.height + dy)
        width = height * aspect
      }
      x = orig.x
      y = orig.y
      break
    }
    case 'nw': {
      width = Math.max(minSize, orig.width - dx)
      height = keepAspect ? width / aspect : Math.max(minSize, orig.height - dy)
      if (keepAspect && Math.abs(dy) > Math.abs(dx)) {
        height = Math.max(minSize, orig.height - dy)
        width = height * aspect
      }
      x = right - width
      y = bottom - height
      break
    }
    case 'ne': {
      width = Math.max(minSize, orig.width + dx)
      height = keepAspect ? width / aspect : Math.max(minSize, orig.height - dy)
      if (keepAspect && Math.abs(dy) > Math.abs(dx)) {
        height = Math.max(minSize, orig.height - dy)
        width = height * aspect
      }
      x = orig.x
      y = bottom - height
      break
    }
    case 'sw': {
      width = Math.max(minSize, orig.width - dx)
      height = keepAspect ? width / aspect : Math.max(minSize, orig.height + dy)
      if (keepAspect && Math.abs(dy) > Math.abs(dx)) {
        height = Math.max(minSize, orig.height + dy)
        width = height * aspect
      }
      x = right - width
      y = orig.y
      break
    }
    // Uniform scale edges (media / free text)
    case 'e': {
      const newW = Math.max(minSize, orig.width + dx)
      const scale = newW / Math.max(1e-6, orig.width)
      width = newW
      height = Math.max(minSize, orig.height * scale)
      x = orig.x
      y = midY - height / 2
      break
    }
    case 'w': {
      const newW = Math.max(minSize, orig.width - dx)
      const scale = newW / Math.max(1e-6, orig.width)
      width = newW
      height = Math.max(minSize, orig.height * scale)
      x = right - width
      y = midY - height / 2
      break
    }
    case 's': {
      const newH = Math.max(minSize, orig.height + dy)
      const scale = newH / Math.max(1e-6, orig.height)
      height = newH
      width = Math.max(minSize, orig.width * scale)
      y = orig.y
      x = midX - width / 2
      break
    }
    case 'n': {
      const newH = Math.max(minSize, orig.height - dy)
      const scale = newH / Math.max(1e-6, orig.height)
      height = newH
      width = Math.max(minSize, orig.width * scale)
      y = bottom - height
      x = midX - width / 2
      break
    }
    default:
      break
  }

  return { x, y, width, height }
}

export function isCardType(type: string): boolean {
  return type === 'textcard' || type === 'link' || type === 'embed'
}

/** Edge drag resizes one side only (note / link / free text / embed) */
export function isEdgeResizeType(type: string): boolean {
  return (
    type === 'textcard' ||
    type === 'link' ||
    type === 'text' ||
    type === 'embed'
  )
}
