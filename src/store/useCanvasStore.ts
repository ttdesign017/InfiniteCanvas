import { create } from 'zustand'
import { ROOT_CONTAINER_ID } from '../types/canvas'
import { createDocumentActions } from './actions/documentActions'
import { createHistoryActions } from './actions/historyActions'
import { createSelectionActions } from './actions/selectionActions'
import { createStackActions } from './actions/stackActions'
import { createViewportActions } from './actions/viewportActions'
import { DEFAULT_VIEWPORT, type CanvasState } from './canvasStoreTypes'

export type { CanvasState } from './canvasStoreTypes'
export type { HistoryEntry, ItemPatchOptions, StackEnterAnim } from './types'

export { FONT_STACKS } from './canvasStoreTypes'

export const useCanvasStore = create<CanvasState>((set, get) => ({
  items: [],

  stacks: [],

  currentContainerId: ROOT_CONTAINER_ID,

  homeViewport: { ...DEFAULT_VIEWPORT },

  selectedIds: [],

  selectedStackIds: [],

  tool: 'select',

  viewport: { ...DEFAULT_VIEWPORT },

  nextZ: 1,

  spaceHeld: false,

  cHeld: false,

  isPanning: false,

  scribbleColor: '#0d99ff',

  scribbleWidth: 3,

  eraseWidth: 18,

  activeScribbleId: null,

  boardName: 'Untitled Board',

  boardFilePath: null,

  dirty: false,

  agentRevision: 0,

  animating: false,

  editingId: null,

  editingStackGroupId: null,

  snapEnabled: true,

  immersiveMode: true,

  isSaving: false,

  saveNotice: null,

  saveNoticeSeq: 0,

  stackEnterAnim: null,

  pendingNavigation: null,

  history: [],

  future: [],
  ...createViewportActions(set, get),
  ...createSelectionActions(set, get),
  ...createHistoryActions(set, get),
  ...createDocumentActions(set, get),
  ...createStackActions(set, get),
}))
