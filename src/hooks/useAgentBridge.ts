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
  rename,
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
import { diagError, diagInfo } from '../utils/diagLog'

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
    dirty: s.dirty,
    revision: s.agentRevision ?? 0,
    itemCount: s.items.length,
    stackCount: s.stacks.length,
  }
  const path = await join(dir, SESSION_FILE)
  await writeTextFile(path, JSON.stringify(payload, null, 2))
}

async function processRequest(dir: string, name: string): Promise<void> {
  const reqPath = await join(dir, name)
  const claimedPath = `${reqPath}.processing`

  // Atomic claim: overlapping polls, multiple windows, or multiple app
  // processes must never apply the same mutation twice.
  try {
    await rename(reqPath, claimedPath)
  } catch {
    return
  }

  let raw: string
  try {
    raw = await readTextFile(claimedPath)
  } catch {
    // A transient read failure should make the request visible for a later poll.
    await rename(claimedPath, reqPath).catch(() => {})
    return
  }
  let req: AgentRequest
  try {
    req = JSON.parse(raw) as AgentRequest
  } catch {
    await remove(claimedPath).catch(() => {})
    return
  }

  const resPath = await join(dir, `${RES_PREFIX}${req.id}.json`)
  // A requester may retry an ID after receiving a timeout. A durable response is
  // the idempotency record: consume the duplicate request without reapplying it.
  if (await exists(resPath)) {
    await remove(claimedPath).catch(() => {})
    return
  }

  let response: AgentResponse
  try {
    const view = liveBoardViewFromStore()
    const screen = {
      width: typeof window !== 'undefined' ? window.innerWidth : 1440,
      height: typeof window !== 'undefined' ? window.innerHeight : 900,
    }
    const result = dispatchAgentOp(
      {
        board: view,
        screen,
        persist: 'live',
        visibleInLiveBoard: true,
      },
      req.body,
    )
    if (result.mutation && !result.mutation.dryRun) {
      const revision = applyMutationToStore(result.mutation)
      // Re-stamp envelope with post-apply store truth
      if (
        result.response &&
        typeof result.response === 'object' &&
        result.response !== null &&
        'ok' in (result.response as object)
      ) {
        const env = result.response as Record<string, unknown>
        env.revision = revision
        env.persisted = 'live'
        env.visibleInLiveBoard = true
        env.dirty = true
        env.pendingUserSave = true
        env.autoSaved = false
        // Final RAW against live store
        const live = liveBoardViewFromStore()
        const itemIds = (env.createdIds as string[]) || []
        const stackIds = (env.createdStackIds as string[]) || []
        for (const id of itemIds) {
          if (!live.items.some((i) => i.id === id)) {
            throw new Error(`Post-apply item missing: ${id}`)
          }
        }
        for (const id of stackIds) {
          if (!live.stacks.some((s) => s.id === id)) {
            throw new Error(`Post-apply stack missing: ${id}`)
          }
        }
        env.verified = { items: itemIds, stacks: stackIds }
        env.meta = {
          ...(typeof env.meta === 'object' && env.meta ? env.meta : {}),
          itemCount: live.items.length,
          stackCount: live.stacks.length,
          revision,
        }
      }
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

  // Only remove the claim after the complete response is durable. If this write
  // fails, the .processing file deliberately remains as an exactly-once safety
  // marker instead of exposing the mutation for duplicate execution.
  await writeTextFile(resPath, JSON.stringify(response))
  await remove(claimedPath).catch(() => {})
}

async function pollOnce(dir: string): Promise<void> {
  let entries: Awaited<ReturnType<typeof readDir>>
  try {
    entries = await readDir(dir)
  } catch {
    return
  }
  // File-system enumeration order is not stable. Deterministic ordering also
  // makes dependent agent operations observe the order in which they were named.
  const ordered = [...entries].sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? ''),
  )
  for (const ent of ordered) {
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
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    void (async () => {
      try {
        const dir = await resolveAgentDirTauri()
        if (cancelled) return
        await writeSession(dir)
        diagInfo('agent-bridge', 'live session heartbeat started', { dir })

        heartbeat = setInterval(() => {
          void writeSession(dir).catch((err) => {
            diagError('agent-bridge', 'session heartbeat failed', err)
          })
        }, 2000)

        const schedulePoll = (delay: number) => {
          pollTimer = setTimeout(() => {
            void pollOnce(dir)
              .catch((err) => {
                diagError('agent-bridge', 'poll failed', err)
              })
              .finally(() => {
                if (!cancelled) schedulePoll(350)
              })
          }, delay)
        }
        // Self-scheduling rather than setInterval: the next poll cannot begin
        // until the current directory scan and every claimed request completes.
        schedulePoll(0)
      } catch (err) {
        diagError('agent-bridge', 'init failed', err)
        console.error('[agent-bridge] init failed', err)
      }
    })()

    return () => {
      cancelled = true
      if (heartbeat) clearInterval(heartbeat)
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [])
}
