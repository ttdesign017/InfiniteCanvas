const PAINT_CULL_MARGIN_PX = 720
export const PAINT_CULLED_CLASS = 'is-paint-culled'

let observer: IntersectionObserver | null = null

export function shouldPaintCullRect(
  rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
  viewportWidth: number,
  viewportHeight: number,
  margin = PAINT_CULL_MARGIN_PX,
): boolean {
  return (
    rect.right < -margin ||
    rect.bottom < -margin ||
    rect.left > viewportWidth + margin ||
    rect.top > viewportHeight + margin
  )
}

function setCulled(element: Element, culled: boolean) {
  element.classList.toggle(PAINT_CULLED_CLASS, culled)
}

function getObserver(): IntersectionObserver | null {
  if (observer) return observer
  if (typeof IntersectionObserver === 'undefined') return null
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        setCulled(entry.target, !entry.isIntersecting)
      }
    },
    {
      root: null,
      rootMargin: `${PAINT_CULL_MARGIN_PX}px`,
      threshold: 0,
    },
  )
  return observer
}

/**
 * Keeps media DOM mounted while skipping paint for cards far outside the
 * viewport. The wide observer margin provides hysteresis, avoiding blank
 * flashes when a fast pan brings a card back on screen.
 */
export function observeViewportPaint(element: HTMLElement): () => void {
  if (typeof window !== 'undefined') {
    const rect = element.getBoundingClientRect()
    setCulled(
      element,
      shouldPaintCullRect(rect, window.innerWidth, window.innerHeight),
    )
  }

  const io = getObserver()
  io?.observe(element)
  return () => {
    io?.unobserve(element)
    setCulled(element, false)
  }
}
