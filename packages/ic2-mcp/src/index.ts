#!/usr/bin/env node
/**
 * Infinite Canvas 2 — MCP server (stdio).
 *
 *   cd packages/ic2-mcp && npm start
 *   IC2_MCP_ALLOW_WRITE=1 IC2_MCP_BOARD_PATH=D:\board.icanvas npm start
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createIc2McpServer } from './server.js'

async function main() {
  const server = createIc2McpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[ic2-mcp] fatal', err)
  process.exit(1)
})
