/**
 * CanvasItem / StackRecord → Agent DTOs (no media bytes).
 */

import type { CanvasItem, StackRecord } from '../types/canvas'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { containerOf } from '../utils/stacks'
import type {
  ItemDetailDto,
  ItemSummaryDto,
  MediaRefDto,
  PoseDto,
  StackSummaryDto,
} from './dto'

export function poseOf(
  it: Pick<
    CanvasItem | StackRecord,
    'x' | 'y' | 'width' | 'height' | 'zIndex'
  > & { rotation?: number },
): PoseDto {
  return {
    x: it.x,
    y: it.y,
    width: it.width,
    height: it.height,
    rotation: 'rotation' in it ? (it.rotation ?? 0) : 0,
    zIndex: it.zIndex,
  }
}

function srcKind(src: string | undefined): MediaRefDto['srcKind'] {
  if (!src) return undefined
  if (src.startsWith('blob:')) return 'blob'
  if (src.startsWith('data:')) return 'data'
  if (src.startsWith('icanvas-asset://')) return 'asset'
  if (/^https?:\/\//i.test(src)) return 'http'
  if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('\\\\')) return 'path'
  return 'other'
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, Math.max(0, max - 1)) + '…'
}

export function itemLabel(item: CanvasItem): string {
  switch (item.type) {
    case 'text':
    case 'textcard':
      return truncate(item.content || '(empty note)', 80)
    case 'link':
      return truncate(item.title || item.url || 'link', 80)
    case 'image':
    case 'gif':
    case 'video':
    case 'audio':
      return item.fileName || item.type
    case 'scribble':
      return 'scribble'
    case 'embed':
      return truncate(item.title || 'embed', 80)
    default:
      return (item as CanvasItem).type
  }
}

export function toItemSummary(item: CanvasItem): ItemSummaryDto {
  const base: ItemSummaryDto = {
    id: item.id,
    type: item.type,
    containerId: containerOf(item),
    pose: poseOf(item),
    label: itemLabel(item),
    ...(item.locked ? { locked: true } : {}),
  }

  if (
    item.type === 'image' ||
    item.type === 'gif' ||
    item.type === 'video' ||
    item.type === 'audio'
  ) {
    base.media = {
      hasMedia: true,
      fileName: item.fileName,
      ...(item.type !== 'audio'
        ? {
            naturalWidth: item.naturalWidth,
            naturalHeight: item.naturalHeight,
          }
        : {}),
      srcKind: srcKind(item.src),
    }
  }

  if (item.type === 'link') {
    base.url = item.url
  }

  return base
}

export function toItemDetail(item: CanvasItem): ItemDetailDto {
  const summary = toItemSummary(item)
  const detail: ItemDetailDto = { ...summary }

  if (item.type === 'text' || item.type === 'textcard') {
    detail.content = item.content
    detail.style = {
      fontSize: item.fontSize,
      color: item.color,
      backgroundColor: item.backgroundColor,
      ...(item.type === 'text'
        ? {
            fontFamily: item.fontFamily,
            fontWeight: item.fontWeight,
          }
        : {}),
    }
  }

  if (item.type === 'link') {
    detail.link = {
      url: item.url,
      title: item.title,
      description: item.description,
    }
    detail.content = [item.title, item.description, item.url]
      .filter(Boolean)
      .join('\n')
  }

  return detail
}

export function toStackSummary(
  st: StackRecord,
  items: CanvasItem[],
  stacks: StackRecord[],
): StackSummaryDto {
  const itemCount = items.filter((i) => containerOf(i) === st.id).length
  const childStackCount = stacks.filter((s) => s.parentId === st.id).length
  return {
    id: st.id,
    parentId: st.parentId || ROOT_CONTAINER_ID,
    name: st.name || '',
    pose: poseOf(st),
    childStackCount,
    itemCount,
  }
}
