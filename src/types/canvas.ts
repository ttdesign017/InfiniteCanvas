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
  | 'embed'

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

/** Root canvas id for nested stack navigation */
export const ROOT_CONTAINER_ID = 'root'

/**
 * A stack is an enterable nested canvas.
 * On the parent canvas it appears as folder chrome; its children live inside.
 */
export interface StackRecord {
  id: string
  /** Parent container: `root` or another stack id */
  parentId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  /** Last viewport while editing inside this stack */
  viewport?: Viewport
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
  /**
   * Canvas container this item belongs to (`root` or a stack id).
   * Undefined is treated as root for backwards compatibility.
   */
  containerId?: string
  /**
   * Same-canvas visual stack group (transient fan during Ctrl+G, or legacy boards).
   * Nested stack membership uses `containerId` + `StackRecord` instead —
   * do not leave stacked/stackGroupId set on nested members after nesting.
   */
  stackGroupId?: string
  /** Same-canvas fan chrome (see stackGroupId) */
  stacked?: boolean
  /** @deprecated Prefer StackRecord.name; kept for legacy files */
  stackName?: string
  /**
   * Fan pose on the *parent* canvas while this item lives inside a stack
   * (`containerId` = that stack). Parent renders previews from this field.
   * `x/y/rotation` remain the free pose inside the stack.
   */
  stackPreview?: {
    x: number
    y: number
    rotation: number
  }
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
  /** Whether remote bookmark metadata has already been resolved. */
  previewStatus?: 'pending' | 'complete'
}

export interface ScribbleItem extends BaseItem {
  type: 'scribble'
  paths: ScribblePath[]
  strokeColor: string
  strokeWidth: number
}

/** Embedded HTML (e.g. podcast / music iframe) */
export interface EmbedItem extends BaseItem {
  type: 'embed'
  /** Original embed markup (iframe) */
  html: string
  /** Resolved iframe src */
  src: string
  title?: string
}

export type CanvasItem =
  | MediaItem
  | TextItem
  | TextCardItem
  | LinkCardItem
  | ScribbleItem
  | EmbedItem

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface BoardSnapshot {
  version: 1
  name: string
  viewport: Viewport
  /** Root-canvas viewport when `viewport` currently belongs to a nested stack. */
  homeViewport?: Viewport
  items: CanvasItem[]
  nextZ: number
  /** Nested stack folders (enterable canvases) */
  stacks?: StackRecord[]
  /** Active nested canvas; omit or `root` = home */
  currentContainerId?: string
}
