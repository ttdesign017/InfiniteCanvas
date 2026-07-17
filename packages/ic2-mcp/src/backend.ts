/**
 * Unified backend: prefer live Infinite Canvas window, else in-process file session.
 */

import {
  boardViewFromSnapshot,
  type BoardView,
} from '../../../src/board-ops/types'
import { dispatchAgentOp } from '../../../src/board-ops/dispatch'
import type { AgentOp } from '../../../src/board-ops/agentProtocol'
import { BoardOpsError } from '../../../src/board-ops/errors'
import type { Session } from './session'
import { applyMutation, openBoard, requireBoard, saveBoard } from './session'
import { isLiveAvailable, liveCall, readLiveSession } from './liveClient'
import { fetchImageAsDataUrl } from './fetchImage'

export type BackendMode = 'live' | 'file' | 'none'

export function getBackendMode(session: Session): BackendMode {
  if (isLiveAvailable()) return 'live'
  if (session.snapshot) return 'file'
  return 'none'
}

export function statusInfo(session: Session) {
  const live = readLiveSession()
  return {
    mode: getBackendMode(session),
    live: live
      ? {
          boardName: live.boardName,
          boardPath: live.boardPath,
          currentContainerId: live.currentContainerId,
          aliveAt: live.aliveAt,
          allowAgentWrite: live.allowAgentWrite,
        }
      : null,
    file: session.snapshot
      ? {
          path: session.path,
          dirty: session.dirty,
          name: session.snapshot.name,
        }
      : null,
    allowWrite: session.config.allowWrite,
  }
}

/** Resolve image URLs inside research cluster / create_image before dispatch. */
function dataUrlParts(dataUrl: string): { mime: string; b64: string } | null {
  const m = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/i)
  if (!m) return null
  return { mime: m[1], b64: m[2] }
}

async function prepareOp(body: AgentOp): Promise<AgentOp> {
  if (body.op === 'create_image' && body.input.src.startsWith('http')) {
    const img = await fetchImageAsDataUrl(body.input.src)
    const parts = dataUrlParts(img.dataUrl)
    return {
      ...body,
      input: {
        ...body.input,
        src: img.dataUrl,
        fileName: body.input.fileName || img.fileName,
        assetMime: img.mime,
        assetBase64: parts?.b64,
      },
    }
  }
  if (body.op === 'create_image' && body.input.src.startsWith('data:')) {
    const parts = dataUrlParts(body.input.src)
    if (parts && !body.input.assetBase64) {
      return {
        ...body,
        input: {
          ...body.input,
          assetMime: body.input.assetMime || parts.mime,
          assetBase64: parts.b64,
        },
      }
    }
  }
  if (body.op === 'add_research_cluster') {
    const images = []
    for (const im of body.input.images || []) {
      if (im.dataUrl) {
        images.push(im)
        continue
      }
      if (im.url) {
        const fetched = await fetchImageAsDataUrl(im.url)
        images.push({
          ...im,
          dataUrl: fetched.dataUrl,
          fileName: im.fileName || fetched.fileName,
        })
      }
    }
    return {
      ...body,
      input: { ...body.input, images },
    }
  }
  return body
}

export async function runOp(
  session: Session,
  body: AgentOp,
): Promise<unknown> {
  const prepared = await prepareOp(body)
  const mode = getBackendMode(session)

  // Prefer live when app is running
  if (isLiveAvailable()) {
    return liveCall(prepared)
  }

  // File session
  if (mode === 'file' || session.snapshot) {
    const { view } = requireBoard(session)
    const result = dispatchAgentOp({ board: view }, prepared)
    if (result.mutation) {
      applyMutation(session, result.mutation)
      // Merge packed asset for data-url images into snapshot for save
      if (
        session.snapshot &&
        prepared.op === 'create_image' &&
        prepared.input.assetBase64 &&
        result.mutation.createdIds[0]
      ) {
        const id = result.mutation.createdIds[0]
        const assets = { ...(session.snapshot.packedAssets || {}) }
        assets[id] = {
          mime: prepared.input.assetMime || 'image/jpeg',
          data: prepared.input.assetBase64,
          fileName: prepared.input.fileName,
        }
        // rewrite item src to asset ref for portable save
        session.snapshot = {
          ...session.snapshot,
          packedAssets: assets,
          items: session.snapshot.items.map((it) =>
            it.id === id && it.type === 'image'
              ? { ...it, src: `icanvas-asset://${id}` }
              : it,
          ),
        }
      }
    }
    return result.response
  }

  // Allow open via dedicated path only
  if (prepared.op === 'ping') {
    return { pong: true, mode: 'none' }
  }

  throw new BoardOpsError(
    'OPEN_FAILED',
    'No board context. Open Infinite Canvas (live) or call ic2_board_open with a file path.',
  )
}

export function openFileBoard(session: Session, path: string): BoardView {
  return openBoard(session, path)
}

export function saveFileBoard(session: Session, path?: string | null) {
  return saveBoard(session, path)
}

export function fileBoardView(session: Session): BoardView {
  return boardViewFromSnapshot(requireBoard(session).snapshot)
}
