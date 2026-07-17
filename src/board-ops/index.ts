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
  NoteRole,
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
  getStack,
  listItems,
  requireStack,
  searchItems,
} from './read'

export {
  buildWriteEnvelope,
  nextRevision,
  partitionCreatedIds,
  verifyBoardHas,
  withRevision,
} from './writeResult'
export type { PersistState, WriteResultEnvelope } from './writeResult'

export {
  createNote,
  createNotesBatch,
  estimateTextBlockSize,
  extractHexColor,
  itemsInBoardContainer,
  measureTextUnits,
  moveItems,
  resolveNoteStyle,
  updateText,
} from './write'

export {
  addResearchCluster,
  createImage,
  createLink,
  createStack,
  layoutGrid,
  looksLikeImageUrl,
  moveToContainer,
  renameStack,
  seedStackFanPreview,
  worldRectFromViewport,
} from './writeExtras'

export { dispatchAgentOp } from './dispatch'
export type { DispatchContext, DispatchResult } from './dispatch'

export {
  applyMutationToStore,
  liveBoardViewFromStore,
  liveMetaFromStore,
} from './applyLive'

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

export { AGENT_PROTOCOL_VERSION } from './agentProtocol'
export type {
  AgentOp,
  AgentRequest,
  AgentResponse,
  AgentSessionFile,
  CreateImageInput,
  CreateLinkInput,
  CreateStackInput,
  LayoutGridInput,
  MoveToContainerInput,
  ResearchClusterInput,
  ViewportInfo,
} from './agentProtocol'
