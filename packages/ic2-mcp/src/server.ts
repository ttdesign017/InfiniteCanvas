import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { loadConfig } from './config.js'
import { createSession, openBoard } from './session.js'
import { registerTools } from './tools.js'
import { getBoardMeta } from '../../../src/board-ops/index'

export function createIc2McpServer(): McpServer {
  const config = loadConfig()
  const session = createSession(config)

  const server = new McpServer({
    name: 'ic2-mcp',
    version: '0.1.0',
  })

  registerTools(server, session)

  if (config.initialBoardPath) {
    try {
      const view = openBoard(session, config.initialBoardPath)
      console.error(
        `[ic2-mcp] opened ${config.initialBoardPath} (${getBoardMeta(view).itemCount} items)`,
      )
    } catch (err) {
      console.error(
        `[ic2-mcp] failed to open IC2_MCP_BOARD_PATH:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  console.error(
    `[ic2-mcp] ready (allowWrite=${config.allowWrite ? 'yes' : 'no'})`,
  )

  return server
}
