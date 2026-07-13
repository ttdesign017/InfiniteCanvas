import { useSyncExternalStore } from 'react'
import type { CanvasItem } from '../../types/canvas'
import { useCanvasStore } from '../../store/useCanvasStore'
import {
  getTextScalePreview,
  subscribeTextScalePreview,
} from '../../utils/textScalePreview'
import { MediaItemView } from './MediaItemView'
import { TextCardView } from './TextCardView'
import { LinkCardView } from './LinkCardView'
import { ScribbleView } from './ScribbleView'
import { TextItemView } from './TextItemView'

interface Props {
  item: CanvasItem
  selected: boolean
  onPointerDown: (e: React.PointerEvent, item: CanvasItem) => void
}

export function CanvasItemView({ item, selected, onPointerDown }: Props) {
  const setEditingId = useCanvasStore((s) => s.setEditingId)
  const select = useCanvasStore((s) => s.select)
  const editingId = useCanvasStore((s) => s.editingId)
  const preview = useSyncExternalStore(
    subscribeTextScalePreview,
    getTextScalePreview,
    getTextScalePreview,
  )

  const stacked = !!(item.stacked && item.stackGroupId)
  const showResize =
    selected &&
    item.type !== 'scribble' &&
    editingId !== item.id &&
    !stacked
  const editable = !stacked && (item.type === 'text' || item.type === 'textcard')

  const isTextPreview =
    item.type === 'text' && preview && preview.id === item.id

  // Stack fan rotates around bottom-left; free items keep top-left
  // Text scale preview: origin follows fixed corner of the drag handle
  const origin = isTextPreview
    ? preview.origin
    : stacked
      ? 'bottom left'
      : 'top left'

  const x = isTextPreview ? preview.baseX : item.x
  const y = isTextPreview ? preview.baseY : item.y
  const w = isTextPreview ? preview.baseW : item.width
  const h = isTextPreview ? preview.baseH : item.height
  const scale = isTextPreview ? preview.scale : 1
  const rot = item.rotation || 0

  // During transform scale preview, font stays at base — no reflow mid-drag
  const displayItem =
    isTextPreview && item.type === 'text'
      ? { ...item, fontSize: preview.baseFont, width: preview.baseW, height: preview.baseH }
      : item

  return (
    <div
      className={`canvas-item type-${item.type} ${selected ? 'selected' : ''} ${editingId === item.id ? 'is-editing' : ''} ${stacked ? 'is-stacked' : ''} ${isTextPreview ? 'is-text-scaling' : ''}`}
      data-id={item.id}
      style={{
        transform: `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`,
        transformOrigin: origin,
        width: w,
        height: h,
        zIndex: item.zIndex,
      }}
      onPointerDown={(e) => onPointerDown(e, item)}
      onDoubleClick={(e) => {
        if (!editable) {
          e.stopPropagation()
          e.preventDefault()
          return
        }
        e.stopPropagation()
        e.preventDefault()
        select([item.id])
        setEditingId(item.id)
      }}
    >
      {item.type === 'image' || item.type === 'gif' || item.type === 'video' ? (
        <MediaItemView item={item} selected={selected} />
      ) : item.type === 'text' ? (
        <TextItemView item={displayItem as typeof item & { type: 'text' }} selected={selected} />
      ) : item.type === 'textcard' ? (
        <TextCardView item={item} selected={selected} />
      ) : item.type === 'link' ? (
        <LinkCardView item={item} selected={selected} />
      ) : item.type === 'scribble' ? (
        <ScribbleView item={item} selected={selected} />
      ) : null}

      {showResize && (
        <>
          <span
            className={`resize-edge n ${
              item.type === 'textcard' || item.type === 'link' || item.type === 'text'
                ? 'card-edge'
                : ''
            }`}
            data-handle="n"
          />
          <span
            className={`resize-edge e ${
              item.type === 'textcard' || item.type === 'link' || item.type === 'text'
                ? 'card-edge'
                : ''
            }`}
            data-handle="e"
          />
          <span
            className={`resize-edge s ${
              item.type === 'textcard' || item.type === 'link' || item.type === 'text'
                ? 'card-edge'
                : ''
            }`}
            data-handle="s"
          />
          <span
            className={`resize-edge w ${
              item.type === 'textcard' || item.type === 'link' || item.type === 'text'
                ? 'card-edge'
                : ''
            }`}
            data-handle="w"
          />
          <span className="resize-handle nw" data-handle="nw" />
          <span className="resize-handle ne" data-handle="ne" />
          <span className="resize-handle se" data-handle="se" />
          <span className="resize-handle sw" data-handle="sw" />
        </>
      )}
    </div>
  )
}
