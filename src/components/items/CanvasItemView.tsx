import { memo, useSyncExternalStore } from 'react'
import type { CanvasItem } from '../../types/canvas'
import { useCanvasStore } from '../../store/useCanvasStore'
import {
  getTextScalePreview,
  subscribeTextScalePreview,
} from '../../utils/textScalePreview'
import {
  getItemSpawnVersion,
  getItemSpawnVisual,
  subscribeItemSpawn,
} from '../../utils/itemSpawnAnim'
import { expandStackSelection } from '../../utils/layout'
import { MediaItemView } from './MediaItemView'
import { TextCardView } from './TextCardView'
import { LinkCardView } from './LinkCardView'
import { ScribbleView } from './ScribbleView'
import { TextItemView } from './TextItemView'
import { EmbedItemView } from './EmbedItemView'
import { AudioItemView } from './AudioItemView'
import { openExternal } from '../../utils/desktop'

interface Props {
  item: CanvasItem
  selected: boolean
  onPointerDown: (e: React.PointerEvent, item: CanvasItem) => void
  /** Dedicated resize entry — must not go through move path */
  onResizePointerDown: (
    e: React.PointerEvent,
    item: CanvasItem,
    handle: string,
  ) => void
  /**
   * Peer ghost during stack enter/exit: media paints static stills
   * (no live video decoder / remount flash).
   */
  staticPreview?: boolean
}

function CanvasItemViewInner({
  item,
  selected,
  onPointerDown,
  onResizePointerDown,
  staticPreview = false,
}: Props) {
  const select = useCanvasStore((s) => s.select)
  const editingId = useCanvasStore((s) => s.editingId)
  const preview = useSyncExternalStore(
    subscribeTextScalePreview,
    getTextScalePreview,
    getTextScalePreview,
  )
  const spawn = useSyncExternalStore(
    subscribeItemSpawn,
    () => {
      void getItemSpawnVersion()
      return getItemSpawnVisual(item.id)
    },
    () => null,
  )

  const stacked = !!(item.stacked && item.stackGroupId)
  // Selection chrome unchanged: media/text/note/link get handles; scribble/embed no.
  // G/R/S modal only restricts keyboard shortcuts — not resize handles.
  const showResize =
    selected &&
    item.type !== 'scribble' &&
    item.type !== 'embed' &&
    item.type !== 'audio' &&
    editingId !== item.id &&
    !stacked
  const showAudioSelectionMarkers =
    selected && item.type === 'audio' && !stacked
  const editable = !stacked && (item.type === 'text' || item.type === 'textcard')

  const isTextPreview =
    item.type === 'text' && preview && preview.id === item.id

  // Free items rotate/scale around geometric center (not top-left)
  const origin = isTextPreview
    ? preview.origin
    : stacked
      ? 'bottom left'
      : 'center center'

  const x = isTextPreview ? preview.baseX : item.x
  const y = isTextPreview ? preview.baseY : item.y
  const w = isTextPreview ? preview.baseW : item.width
  const h = isTextPreview ? preview.baseH : item.height
  const scale = isTextPreview ? preview.scale : 1
  const rot = item.rotation || 0
  const spawnDy = spawn?.dy ?? 0
  const spawnScale = spawn?.scale ?? 1
  const spawnOpacity = spawn?.opacity
  const combinedScale = scale * spawnScale

  const displayItem =
    isTextPreview && item.type === 'text'
      ? { ...item, fontSize: preview.baseFont, width: preview.baseW, height: preview.baseH }
      : item

  const edgeClass =
    item.type === 'textcard' || item.type === 'link' || item.type === 'text'
      ? 'card-edge'
      : ''

  const startResize =
    (handle: string) => (e: React.PointerEvent) => {
      // Critical: stop before parent move handler
      e.stopPropagation()
      e.preventDefault()
      onResizePointerDown(e, item, handle)
    }

  return (
    <div
      className={`canvas-item type-${item.type} ${selected ? 'selected' : ''} ${editingId === item.id ? 'is-editing' : ''} ${stacked ? 'is-stacked' : ''} ${isTextPreview ? 'is-text-scaling' : ''}`}
      data-id={item.id}
      style={{
        transform: `translate(${x}px, ${y + spawnDy}px) rotate(${rot}deg) scale(${combinedScale})`,
        transformOrigin: origin,
        width: w,
        height: h,
        zIndex: item.zIndex,
        opacity: spawnOpacity,
        // Scribbles: only stroke geometry receives hits (see .scribble-hit)
        pointerEvents:
          spawn &&
          ((spawnOpacity !== undefined && spawnOpacity < 0.05) ||
            (spawn.scale !== undefined && spawn.scale < 0.95 && Math.abs(spawn.dy) > 1))
            ? 'none'
            : item.type === 'scribble'
              ? 'none'
              : undefined,
      }}
      onPointerDown={(e) => onPointerDown(e, item)}
      onDoubleClick={(e) => {
        // Backup if browser fires dblclick (primary path: pending-move / detail>=2)
        e.stopPropagation()
        e.preventDefault()
        // Stacked cards / previews: enter nested canvas (rename only via folder tab)
        if (stacked && item.stackGroupId) {
          const st = useCanvasStore.getState()
          if (st.stacks.some((s) => s.id === item.stackGroupId)) {
            st.enterStack(item.stackGroupId!)
            return
          }
          const items = st.items
          const expanded = expandStackSelection([item.id], items)
          select(expanded)
          useCanvasStore.setState({
            editingStackGroupId: item.stackGroupId,
            editingId: null,
          })
          return
        }
        // Link cards: open URL (also handled in InfiniteCanvas detail>=2)
        if (item.type === 'link' && item.url?.trim()) {
          void openExternal(item.url.trim())
          return
        }
        // Scribble layer: double-click reopens the pen session for more strokes
        if (!stacked && item.type === 'scribble') {
          useCanvasStore.getState().enterScribbleEdit(item.id)
          return
        }
        if (!editable) return
        if (!selected) select([item.id])
        // select() clears editingId — must set after
        useCanvasStore.setState({
          editingId: item.id,
          editingStackGroupId: null,
        })
      }}
    >
      {item.type === 'image' || item.type === 'gif' || item.type === 'video' ? (
        <MediaItemView
          item={item}
          selected={selected}
          staticPreview={staticPreview}
        />
      ) : item.type === 'audio' ? (
        <AudioItemView item={item} selected={selected} />
      ) : item.type === 'text' ? (
        <TextItemView item={displayItem as typeof item & { type: 'text' }} selected={selected} />
      ) : item.type === 'textcard' ? (
        <TextCardView item={item} selected={selected} />
      ) : item.type === 'link' ? (
        <LinkCardView item={item} selected={selected} />
      ) : item.type === 'scribble' ? (
        <ScribbleView item={item} selected={selected} />
      ) : item.type === 'embed' ? (
        <EmbedItemView
          item={item}
          selected={selected}
          stackPreview={stacked}
        />
      ) : null}

      {showResize && (
        <>
          <span
            className={`resize-edge n ${edgeClass}`}
            data-handle="n"
            onPointerDown={startResize('n')}
          />
          <span
            className={`resize-edge e ${edgeClass}`}
            data-handle="e"
            onPointerDown={startResize('e')}
          />
          <span
            className={`resize-edge s ${edgeClass}`}
            data-handle="s"
            onPointerDown={startResize('s')}
          />
          <span
            className={`resize-edge w ${edgeClass}`}
            data-handle="w"
            onPointerDown={startResize('w')}
          />
          <span
            className="resize-handle nw"
            data-handle="nw"
            onPointerDown={startResize('nw')}
          />
          <span
            className="resize-handle ne"
            data-handle="ne"
            onPointerDown={startResize('ne')}
          />
          <span
            className="resize-handle se"
            data-handle="se"
            onPointerDown={startResize('se')}
          />
          <span
            className="resize-handle sw"
            data-handle="sw"
            onPointerDown={startResize('sw')}
          />
        </>
      )}
      {showAudioSelectionMarkers && (
        <>
          <span className="audio-selection-handle nw" aria-hidden />
          <span className="audio-selection-handle ne" aria-hidden />
          <span className="audio-selection-handle se" aria-hidden />
          <span className="audio-selection-handle sw" aria-hidden />
        </>
      )}
    </div>
  )
}

/** Skip re-render when this item's data/selection is unchanged (big win while dragging peers). */
export const CanvasItemView = memo(
  CanvasItemViewInner,
  (prev, next) =>
    prev.item === next.item &&
    prev.selected === next.selected &&
    prev.staticPreview === next.staticPreview &&
    prev.onPointerDown === next.onPointerDown &&
    prev.onResizePointerDown === next.onResizePointerDown,
)
