export type Tool =
  | 'select'
  | 'pan'
  | 'scribble'
  | 'erase'
  | 'text'
  | 'textcard'
  | 'link'

export type ItemType =
  | 'image'
  | 'gif'
  | 'video'
  | 'text'
  | 'textcard'
  | 'link'
  | 'scribble'

export interface Point {
  x: number
  y: number
}

export interface ScribblePath {
  id: string
  /** Points in item-local coordinates */
  points: Point[]
  color: string
  width: number
}

/** Normalized crop rectangle in source image space (0–1) */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface BaseItem {
  id: string
  type: ItemType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  locked?: boolean
  /** Items sharing this id move as one stack group */
  stackGroupId?: string
  /** Visual: rounded media + folder chrome after Quick Stack */
  stacked?: boolean
  /** Display name on the folder tab (shared by all members of a stack) */
  stackName?: string
}

export interface MediaItem extends BaseItem {
  type: 'image' | 'gif' | 'video'
  src: string
  fileName?: string
  naturalWidth: number
  naturalHeight: number
  /** Cumulative crop of the source, normalized 0–1 */
  crop?: CropRect
}

/** Free-floating text (no card chrome) */
export interface TextItem extends BaseItem {
  type: 'text'
  content: string
  fontSize: number
  fontFamily: string
  fontWeight: number
  color: string
  backgroundColor: string
}

/** Notion-style note card */
export interface TextCardItem extends BaseItem {
  type: 'textcard'
  content: string
  fontSize: number
  /** Body text color */
  color: string
  /** Card surface */
  backgroundColor: string
  /** "Note" label text color */
  labelColor?: string
  /** "Note" label chip background */
  labelBackground?: string
}

export interface LinkCardItem extends BaseItem {
  type: 'link'
  url: string
  title: string
  description: string
  favicon?: string
  /** Open Graph / Twitter card preview image */
  image?: string
  siteName?: string
}

export interface ScribbleItem extends BaseItem {
  type: 'scribble'
  paths: ScribblePath[]
  strokeColor: string
  strokeWidth: number
}

export type CanvasItem =
  | MediaItem
  | TextItem
  | TextCardItem
  | LinkCardItem
  | ScribbleItem

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface BoardSnapshot {
  version: 1
  name: string
  viewport: Viewport
  items: CanvasItem[]
  nextZ: number
}


