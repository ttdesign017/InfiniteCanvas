import { useMemo } from 'react'
import type { ScribbleItem } from '../../types/canvas'
import { useCanvasStore } from '../../store/useCanvasStore'
import { buildScribbleStrokePath } from '../../utils/scribbleStroke'

interface Props {
  item: ScribbleItem
  selected: boolean
}

/** Extra world-space hit slop around each stroke outline. */
export const SCRIBBLE_HIT_SLOP = 6

export function ScribbleView({ item, selected }: Props) {
  // Live layer: last path still being drawn → freehand `last: false` for softer live tip
  const isLiveLayer = useCanvasStore((s) => s.activeScribbleId === item.id)

  const pathData = useMemo(() => {
    const lastIndex = item.paths.length - 1
    return item.paths.map((path, index) => {
      const complete = !(isLiveLayer && index === lastIndex)
      const d = buildScribbleStrokePath(path.points, {
        size: Math.max(1, path.width),
        last: complete,
      })
      const hitD = buildScribbleStrokePath(path.points, {
        size: Math.max(1, path.width),
        sizeBoost: SCRIBBLE_HIT_SLOP * 2,
        last: complete,
      })
      return { id: path.id, color: path.color, d, hitD }
    })
  }, [item.paths, isLiveLayer])

  return (
    <div
      className={`scribble-item ${selected ? 'is-selected' : ''}`}
      title={selected ? 'Double-click to edit strokes' : undefined}
    >
      <svg
        width={item.width}
        height={item.height}
        viewBox={`0 0 ${item.width} ${item.height}`}
        className="scribble-svg"
        style={{ overflow: 'visible' }}
      >
        {pathData.map(({ id, color, d, hitD }) => {
          if (!d) return null
          return (
            <g key={id}>
              <path
                className="scribble-hit"
                d={hitD || d}
                fill="transparent"
                stroke="none"
              />
              <path
                className="scribble-stroke"
                d={d}
                fill={color}
                stroke="none"
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
