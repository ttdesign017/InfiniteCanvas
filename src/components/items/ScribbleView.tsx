import type { ScribbleItem } from '../../types/canvas'

interface Props {
  item: ScribbleItem
  selected: boolean
}

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
    <div className={`scribble-item ${selected ? 'is-selected' : ''}`}>
      <svg
        width={item.width}
        height={item.height}
        viewBox={`0 0 ${item.width} ${item.height}`}
        className="scribble-svg"
      >
        {item.paths.map((path) => (
          <path
            key={path.id}
            d={pathToD(path.points)}
            stroke={path.color}
            strokeWidth={path.width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  )
}
