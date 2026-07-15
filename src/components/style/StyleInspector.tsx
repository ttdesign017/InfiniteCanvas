import { FONT_STACKS, useCanvasStore } from '../../store/useCanvasStore'
import type { ScribbleItem, TextCardItem, TextItem } from '../../types/canvas'
import { recomputeScribbleBounds } from '../../utils/scribble'
import { useHistoryOnce } from '../../hooks/useHistoryOnce'
import {
  ChipButton,
  ColorField,
  SizeField,
  StyleField,
  StylePanel,
  toHexColor,
} from './StyleControls'

const WEIGHTS = [
  { w: 400, label: 'Regular' },
  { w: 500, label: 'Medium' },
  { w: 600, label: 'Semibold' },
  { w: 700, label: 'Bold' },
] as const

function selectionKey(items: { id: string }[]): string {
  return items.map((i) => i.id).join(',')
}

function TextStylePanel({ items }: { items: TextItem[] }) {
  const updateItem = useCanvasStore((s) => s.updateItem)
  const convertTextKind = useCanvasStore((s) => s.convertTextKind)
  const pushHistoryOnce = useHistoryOnce(selectionKey(items))
  const primary = items[0]
  if (!primary) return null

  const apply = (patch: Partial<TextItem>) => {
    pushHistoryOnce()
    for (const t of items) updateItem(t.id, patch)
  }

  const bgNone = !primary.backgroundColor || primary.backgroundColor === 'transparent'
  const fontLabel =
    FONT_STACKS.find((f) => f.value === primary.fontFamily)?.label ?? 'Font'
  const weightLabel =
    WEIGHTS.find((w) => w.w === primary.fontWeight)?.label ?? String(primary.fontWeight)

  const cycleFont = () => {
    const idx = FONT_STACKS.findIndex((f) => f.value === primary.fontFamily)
    const next = FONT_STACKS[(idx + 1 + FONT_STACKS.length) % FONT_STACKS.length]
    apply({ fontFamily: next.value })
  }

  const cycleWeight = () => {
    const idx = WEIGHTS.findIndex((w) => w.w === primary.fontWeight)
    apply({ fontWeight: WEIGHTS[(idx + 1) % WEIGHTS.length].w })
  }

  return (
    <StylePanel
      title="Text"
      trailing={
        <button
          type="button"
          className="style-convert-btn"
          title="Turn into Note card"
          onClick={(e) => {
            e.stopPropagation()
            convertTextKind(
              'textcard',
              items.map((i) => i.id),
            )
          }}
        >
          To Note
        </button>
      }
    >
      <ColorField
        label="Color"
        value={primary.color}
        fallback="#1e1e1e"
        onChange={(c) => apply({ color: c })}
      />
      <StyleField label="Fill">
        <label className="style-color" title="Background">
          <span
            className="style-color-chip"
            style={{
              background: bgNone ? 'transparent' : toHexColor(primary.backgroundColor, '#ffffff'),
              backgroundImage: bgNone
                ? 'linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%)'
                : undefined,
              backgroundSize: bgNone ? '8px 8px' : undefined,
              backgroundPosition: bgNone ? '0 0,0 4px,4px -4px,-4px 0' : undefined,
            }}
          />
          <input
            type="color"
            value={bgNone ? '#ffffff' : toHexColor(primary.backgroundColor, '#ffffff')}
            onChange={(e) => apply({ backgroundColor: e.target.value })}
            onInput={(e) => apply({ backgroundColor: (e.target as HTMLInputElement).value })}
          />
        </label>
        <button
          type="button"
          className={`style-chip-btn ${bgNone ? 'active' : ''}`}
          title="No background"
          onClick={() => apply({ backgroundColor: 'transparent' })}
        >
          None
        </button>
      </StyleField>
      <ChipButton label="Font" title={`Font: ${fontLabel}`} onClick={cycleFont}>
        {fontLabel}
      </ChipButton>
      <ChipButton label="Weight" title={`Weight: ${weightLabel}`} onClick={cycleWeight}>
        {weightLabel}
      </ChipButton>
      <SizeField
        label="Size"
        value={primary.fontSize}
        min={12}
        max={120}
        onChange={(v) => apply({ fontSize: v })}
      />
    </StylePanel>
  )
}

function NoteStylePanel({ items }: { items: TextCardItem[] }) {
  const updateItem = useCanvasStore((s) => s.updateItem)
  const convertTextKind = useCanvasStore((s) => s.convertTextKind)
  const pushHistoryOnce = useHistoryOnce(selectionKey(items))
  const primary = items[0]
  if (!primary) return null

  const apply = (patch: Partial<TextCardItem>) => {
    pushHistoryOnce()
    for (const n of items) updateItem(n.id, patch)
  }

  return (
    <StylePanel
      title="Note"
      trailing={
        <button
          type="button"
          className="style-convert-btn"
          title="Turn into free-flowing text"
          onClick={(e) => {
            e.stopPropagation()
            convertTextKind(
              'text',
              items.map((i) => i.id),
            )
          }}
        >
          To Text
        </button>
      }
    >
      <ColorField
        label="Text"
        value={primary.color}
        fallback="#6b6b6b"
        onChange={(c) => apply({ color: c })}
      />
      <ColorField
        label="Card"
        value={primary.backgroundColor}
        fallback="#ffffff"
        onChange={(c) => apply({ backgroundColor: c })}
      />
      <SizeField
        label="Size"
        value={primary.fontSize}
        min={11}
        max={48}
        onChange={(v) => apply({ fontSize: v })}
      />
    </StylePanel>
  )
}

/** Apply color / stroke weight to selected scribbles (all paths). */
function applyScribblePatch(
  item: ScribbleItem,
  patch: { color?: string; width?: number },
): Partial<ScribbleItem> {
  const color = patch.color ?? item.strokeColor
  const width = patch.width ?? item.strokeWidth
  const paths = item.paths.map((p) => ({
    ...p,
    color: patch.color ?? p.color,
    width: patch.width ?? p.width,
  }))

  // Recompute bounds when weight changes (stroke padding)
  if (patch.width != null && patch.width !== item.strokeWidth) {
    const worldPaths = paths.map((p) => ({
      ...p,
      points: p.points.map((pt) => ({
        x: pt.x + item.x,
        y: pt.y + item.y,
      })),
    }))
    const pad = Math.max(width, 8)
    const bounds = recomputeScribbleBounds(worldPaths, pad)
    if (bounds) {
      return {
        strokeColor: color,
        strokeWidth: width,
        paths: bounds.paths,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }
    }
  }

  return {
    strokeColor: color,
    strokeWidth: width,
    paths,
  }
}

function ScribbleStylePanel({ items }: { items: ScribbleItem[] }) {
  const updateItem = useCanvasStore((s) => s.updateItem)
  const pushHistoryOnce = useHistoryOnce(selectionKey(items))
  const primary = items[0]
  if (!primary) return null

  const apply = (patch: { color?: string; width?: number }) => {
    pushHistoryOnce()
    // Read live items so multi-select width recompute uses current bounds
    const live = useCanvasStore.getState().items
    for (const s of items) {
      const current = live.find((i) => i.id === s.id)
      if (!current || current.type !== 'scribble') continue
      updateItem(s.id, applyScribblePatch(current, patch))
    }
  }

  return (
    <StylePanel title="Ink">
      <ColorField
        label="Color"
        value={primary.strokeColor || primary.paths[0]?.color || '#0d99ff'}
        fallback="#0d99ff"
        onChange={(c) => apply({ color: c })}
      />
      <SizeField
        label="Weight"
        value={primary.strokeWidth || primary.paths[0]?.width || 3}
        min={1}
        max={48}
        onChange={(v) => apply({ width: v })}
      />
    </StylePanel>
  )
}

function PenToolPanel() {
  const color = useCanvasStore((s) => s.scribbleColor)
  const width = useCanvasStore((s) => s.scribbleWidth)
  const setScribbleStyle = useCanvasStore((s) => s.setScribbleStyle)

  return (
    <StylePanel title="Pen">
      <ColorField
        label="Color"
        value={color}
        fallback="#0d99ff"
        onChange={(c) => setScribbleStyle(c)}
      />
      <SizeField
        label="Weight"
        value={width}
        min={1}
        max={24}
        onChange={(v) => setScribbleStyle(undefined, v)}
      />
    </StylePanel>
  )
}

function EraseToolPanel() {
  const width = useCanvasStore((s) => s.eraseWidth)
  const setEraseWidth = useCanvasStore((s) => s.setEraseWidth)

  return (
    <StylePanel title="Eraser">
      <SizeField label="Size" value={width} min={6} max={48} onChange={setEraseWidth} />
    </StylePanel>
  )
}

/**
 * Top horizontal style inspector — shows panels for free (unstacked) selection
 * and for active pen / eraser tools.
 */
export function StyleInspector() {
  const tool = useCanvasStore((s) => s.tool)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const items = useCanvasStore((s) => s.items)

  const freeSelected = items.filter(
    (i) => selectedIds.includes(i.id) && !i.stacked,
  )

  // Only show selection style when ALL free selected items share one type
  const typeSet = new Set(freeSelected.map((i) => i.type))
  const homogeneous = freeSelected.length > 0 && typeSet.size === 1
  const onlyType = homogeneous ? freeSelected[0].type : null

  const texts =
    onlyType === 'text'
      ? (freeSelected as TextItem[])
      : ([] as TextItem[])
  const notes =
    onlyType === 'textcard'
      ? (freeSelected as TextCardItem[])
      : ([] as TextCardItem[])
  const scribbles =
    onlyType === 'scribble'
      ? (freeSelected as ScribbleItem[])
      : ([] as ScribbleItem[])

  // Tool panels only when nothing mixed-selected needs styles, or no selection
  const showPenTool = tool === 'scribble' && scribbles.length === 0 && freeSelected.length === 0
  const showEraseTool = tool === 'erase' && freeSelected.length === 0

  // When selection is mixed types — hide all selection style bars
  const showSelectionStyle = homogeneous && (texts.length > 0 || notes.length > 0 || scribbles.length > 0)

  const hasAny = showSelectionStyle || showPenTool || showEraseTool

  if (!hasAny) return null

  return (
    <div className="dock dock-top-style">
      {texts.length > 0 && <TextStylePanel items={texts} />}
      {notes.length > 0 && <NoteStylePanel items={notes} />}
      {scribbles.length > 0 && <ScribbleStylePanel items={scribbles} />}
      {showPenTool && <PenToolPanel />}
      {showEraseTool && <EraseToolPanel />}
    </div>
  )
}
