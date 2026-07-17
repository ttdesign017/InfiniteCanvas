/**
 * Live transport: talk to a running Infinite Canvas window via agent inbox files.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  AGENT_APP_DIR,
  AGENT_SUBDIR,
  REQ_PREFIX,
  RES_PREFIX,
  SESSION_FILE,
} from '../../../src/utils/agentPaths'
import {
  AGENT_PROTOCOL_VERSION,
  type AgentOp,
  type AgentRequest,
  type AgentResponse,
  type AgentSessionFile,
} from '../../../src/board-ops/agentProtocol'
import { BoardOpsError } from '../../../src/board-ops/errors'

const SESSION_STALE_MS = 8000
const DEFAULT_TIMEOUT_MS = 60_000

export function resolveAgentDir(): string {
  if (process.platform === 'win32') {
    const base =
      process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return join(base, AGENT_APP_DIR, AGENT_SUBDIR)
  }
  const base =
    process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(base, AGENT_APP_DIR, AGENT_SUBDIR)
}

export function readLiveSession(): AgentSessionFile | null {
  const dir = resolveAgentDir()
  const path = join(dir, SESSION_FILE)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    const s = JSON.parse(raw) as AgentSessionFile
    if (!s || typeof s.aliveAt !== 'number') return null
    if (Date.now() - s.aliveAt > SESSION_STALE_MS) return null
    return s
  } catch {
    return null
  }
}

export function isLiveAvailable(): boolean {
  return readLiveSession() != null
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Send an op to the live app and wait for JSON response.
 */
export async function liveCall(
  body: AgentOp,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const session = readLiveSession()
  if (!session) {
    throw new BoardOpsError(
      'OPEN_FAILED',
      'No live Infinite Canvas session. Open the app, or use file mode (ic2_board_open).',
    )
  }
  if (
    !session.allowAgentWrite &&
    body.op !== 'ping' &&
    body.op !== 'get_meta' &&
    body.op !== 'get_viewport' &&
    body.op !== 'tree' &&
    body.op !== 'list_items' &&
    body.op !== 'get_item' &&
    body.op !== 'export_text' &&
    body.op !== 'search'
  ) {
    throw new BoardOpsError(
      'WRITE_DENIED',
      'Live app has agent write disabled',
    )
  }

  const dir = resolveAgentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const id = randomUUID()
  const req: AgentRequest = {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    id,
    createdAt: Date.now(),
    body,
  }
  const reqPath = join(dir, `${REQ_PREFIX}${id}.json`)
  const resPath = join(dir, `${RES_PREFIX}${id}.json`)
  writeFileSync(reqPath, JSON.stringify(req), 'utf8')

  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      if (existsSync(resPath)) {
        const raw = readFileSync(resPath, 'utf8')
        try {
          unlinkSync(resPath)
        } catch {
          /* ignore */
        }
        const res = JSON.parse(raw) as AgentResponse
        if (!res.ok) {
          throw new BoardOpsError(
            (res.error?.code as never) || 'INTERNAL',
            res.error?.message || 'Live agent error',
            res.error?.detail,
          )
        }
        return res.result
      }
      await sleep(80)
    }
    throw new BoardOpsError(
      'OPEN_FAILED',
      `Live agent timed out after ${timeoutMs}ms (is Infinite Canvas open and focused?)`,
    )
  } finally {
    try {
      if (existsSync(reqPath)) unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
  }
}
