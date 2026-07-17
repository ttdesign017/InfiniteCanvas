/**
 * Live agent bridge: heartbeat session file + poll request inbox.
 * Only active in Tauri desktop builds.
 */

import { useEffect } from 'react'
import { join, localDataDir } from '@tauri-apps/api/path'
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { isDesktop } from '../utils/desktop'
import { useCanvasStore } from '../store/useCanvasStore'
import {
  AGENT_APP_DIR,
  AGENT_SUBDIR,
  REQ_PREFIX,
  RES_PREFIX,
  SESSION_FILE,
} from '../utils/agentPaths'
import {
  AGENT_PROTOCOL_VERSION,
  type AgentRequest,
  type AgentResponse,
  type AgentSessionFile,
} from '../board-ops/agentProtocol'
import { dispatchAgentOp } from '../board-ops/dispatch'
import {
  applyMutationToStore,
  liveBoardViewFromStore,
} from '../board-ops/applyLive'
import { boardErrorToJson, isBoardOpsError } from '../board-ops/errors'

async function resolveAgentDirTauri(): Promise<string> {
  const root = await localDataDir()
  const dir = await join(root, AGENT_APP_DIR, AGENT_SUBDIR)
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true })
  }
  return dir
}

async function writeSession(dir: string): Promise<void> {
  const s = useCanvasStore.getState()
  const payload: AgentSessionFile = {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    pid: 0,
    aliveAt: Date.now(),
    appName: 'InfiniteCanvas2',
    boardPath: s.boardFilePath,
    boardName: s.boardName,
    currentContainerId: s.currentContainerId,
    allowAgentWrite: true,
  }
  const path = await join(dir, SESSION_FILE)
  await writeTextFile(path, JSON.stringify(payload, null, 2))
}

async function processRequest(dir: string, name: string): Promise<void> {
  const reqPath = await join(dir, name)
  let raw: string
  try {
    raw = await readTextFile(reqPath)
  } catch {
    return
  }
  let req: AgentRequest
  try {
    req = JSON.parse(raw) as AgentRequest
  } catch {
    await remove(reqPath).catch(() => {})
    return
  }

  let response: AgentResponse
  try {
    const view = liveBoardViewFromStore()
    const screen = {
      width: typeof window !== 'undefined' ? window.innerWidth : 1440,
      height: typeof window !== 'undefined' ? window.innerHeight : 900,
    }
    const result = dispatchAgentOp({ board: view, screen }, req.body)
    if (result.mutation && !result.mutation.dryRun) {
      applyMutationToStore(result.mutation)
    }
    response = {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      id: req.id,
      ok: true,
      result: result.response,
    }
  } catch (err) {
    const e = boardErrorToJson(err)
    response = {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      id: req.id,
      ok: false,
      error: {
        code: e.code,
        message: e.message,
        detail: e.detail,
      },
    }
    if (!isBoardOpsError(err)) {
      console.error('[agent-bridge]', err)
    }
  }

  const resPath = await join(dir, `${RES_PREFIX}${req.id}.json`)
  await writeTextFile(resPath, JSON.stringify(response))
  await remove(reqPath).catch(() => {})
}

async function pollOnce(dir: string): Promise<void> {
  let entries: Awaited<ReturnType<typeof readDir>>
  try {
    entries = await readDir(dir)
  } catch {
    return
  }
  for (const ent of entries) {
    const name = ent.name
    if (!name || !name.startsWith(REQ_PREFIX) || !name.endsWith('.json')) {
      continue
    }
    await processRequest(dir, name)
  }
}

/** Mount once from App: heartbeats + request polling. */
export function useAgentBridge() {
  useEffect(() => {
    if (!isDesktop()) return
    let cancelled = false
    let heartbeat: ReturnType<typeof setInterval> | null = null
    let poll: ReturnType<typeof setInterval> | null = null

    void (async () => {
      try {
        const dir = await resolveAgentDirTauri()
        if (cancelled) return
        await writeSession(dir)

        heartbeat = setInterval(() => {
          void writeSession(dir)
        }, 2000)

        poll = setInterval(() => {
          void pollOnce(dir)
        }, 350)
      } catch (err) {
        console.error('[agent-bridge] init failed', err)
      }
    })()

    return () => {
      cancelled = true
      if (heartbeat) clearInterval(heartbeat)
      if (poll) clearInterval(poll)
    }
  }, [])
}
