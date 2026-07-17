/**
 * Runtime config for ic2-mcp (env + defaults).
 *
 * IC2_MCP_ALLOW_WRITE=1   enable create/update/move/save
 * IC2_MCP_BOARD_PATH=...  optional board auto-open on start
 */

export type McpConfig = {
  /** When false, write tools return WRITE_DENIED */
  allowWrite: boolean
  /** Optional path opened at server start */
  initialBoardPath: string | null
}

export function loadConfig(): McpConfig {
  // Default ON for research workflows; set IC2_MCP_ALLOW_WRITE=0 to lock.
  const allowWrite =
    process.env.IC2_MCP_ALLOW_WRITE === undefined ||
    process.env.IC2_MCP_ALLOW_WRITE === ''
      ? true
      : process.env.IC2_MCP_ALLOW_WRITE === '1' ||
        process.env.IC2_MCP_ALLOW_WRITE === 'true'
  const initialBoardPath =
    process.env.IC2_MCP_BOARD_PATH?.trim() ||
    process.env.IC2_BOARD_PATH?.trim() ||
    null
  return { allowWrite, initialBoardPath }
}
