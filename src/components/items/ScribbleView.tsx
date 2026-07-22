import type { ScribbleItem } from '../../types/canvas'

interface Props {
  item: ScribbleItem
  selected: boolean
}

/** Extra world-space hit slop around each stroke (half of total pad). */
export const SCRIBBLE_HIT_SLOP = 6

function pathToD(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  let d = `M ${first.x} ${first.y}`
  for (const p of rest) {
    d += ` L ${p.x} ${p.y}`
  }
  return d
}

export function ScribbleView({ item, selected }: Props) {
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
      >
        {item.paths.map((path) => {
          const d = pathToD(path.points)
          if (!d) return null
          // Hit target: stroke width + edge slop so nearby clicks still count
          const hitWidth = Math.max(path.width, 1) + SCRIBBLE_HIT_SLOP * 2
          return (
            <g key={path.id}>
              <path
                className="scribble-hit"
                d={d}
                stroke="transparent"
                strokeWidth={hitWidth}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                className="scribble-stroke"
                d={d}
                stroke={path.color}
                strokeWidth={path.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
