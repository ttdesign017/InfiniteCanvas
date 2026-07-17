/**
 * Board operations — pure domain API for UI and future MCP.
 *
 * @see docs/MCP.md
 * @see docs/BOARD_OPS.md
 */

export { BOARD_OPS_API_VERSION } from './dto'
export type {
  BoardMetaDto,
  ItemDetailDto,
  ItemSummaryDto,
  MediaRefDto,
  PoseDto,
  StackSummaryDto,
  StackTreeNodeDto,
  TextExportBlockDto,
} from './dto'

export {
  BoardOpsError,
  boardErrorToJson,
  formatBoardError,
  isBoardOpsError,
} from './errors'
export type { BoardErrorCode } from './errors'

export {
  boardViewFromSnapshot,
  snapshotFromBoardView,
} from './types'
export type {
  BoardMutationResult,
  BoardView,
  CreateNoteInput,
  ExportTextQuery,
  GetItemQuery,
  ListItemsQuery,
  MoveItemsInput,
  SearchQuery,
  TreeQuery,
  UpdateTextInput,
  WriteOptions,
} from './types'

export {
  buildStackTree,
  exportText,
  getBoardMeta,
  getItem,
  listItems,
  requireStack,
  searchItems,
} from './read'

export {
  createNote,
  createNotesBatch,
  itemsInBoardContainer,
  moveItems,
  updateText,
} from './write'

export {
  ensureIcanvasExt,
  loadBoardSnapshotFromPath,
  loadBoardViewFromPath,
  saveBoardSnapshotToPath,
  saveBoardViewToPath,
} from './fileOps'

export {
  itemLabel,
  poseOf,
  toItemDetail,
  toItemSummary,
  toStackSummary,
} from './project'
