/**
 * Stable error codes for board-ops, MCP tools, and UI mapping.
 * Prefer throwing {@link BoardOpsError} from pure ops; UI/MCP translate to toast or tool error.
 */

export type BoardErrorCode =
  | 'BOARD_TOO_LARGE'
  | 'PARSE_FAILED'
  | 'NOT_ICANVAS'
  | 'ITEM_NOT_FOUND'
  | 'STACK_NOT_FOUND'
  | 'CONTAINER_NOT_FOUND'
  | 'WRITE_DENIED'
  | 'INVALID_PATCH'
  | 'DRY_RUN'
  | 'SAVE_FAILED'
  | 'OPEN_FAILED'
  | 'INTERNAL'

export class BoardOpsError extends Error {
  readonly code: BoardErrorCode
  readonly detail?: string

  constructor(code: BoardErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'BoardOpsError'
    this.code = code
    this.detail = detail
  }
}

export function isBoardOpsError(err: unknown): err is BoardOpsError {
  return err instanceof BoardOpsError
}

/** User-facing one-liner; Agent can also use `code`. */
export function formatBoardError(err: unknown): string {
  if (isBoardOpsError(err)) {
    return err.detail ? `${err.message} (${err.detail})` : err.message
  }
  if (err instanceof Error) return err.message
  return String(err)
}

/** Structured payload for MCP tool error results / logging. */
export function boardErrorToJson(err: unknown): {
  code: BoardErrorCode | 'UNKNOWN'
  message: string
  detail?: string
} {
  if (isBoardOpsError(err)) {
    return {
      code: err.code,
      message: err.message,
      ...(err.detail ? { detail: err.detail } : {}),
    }
  }
  return {
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : String(err),
  }
}
