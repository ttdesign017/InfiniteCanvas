/**
 * Live-agent directory naming (App + MCP agree on folder layout).
 *
 * Full path:
 *   Windows: %LOCALAPPDATA%/InfiniteCanvas/agent
 *   Unix:    $XDG_DATA_HOME/InfiniteCanvas/agent  or ~/.local/share/...
 */

export const AGENT_APP_DIR = 'InfiniteCanvas'
export const AGENT_SUBDIR = 'agent'
export const SESSION_FILE = 'session.json'
export const REQ_PREFIX = 'req-'
export const RES_PREFIX = 'res-'

export function sessionFileName(): string {
  return SESSION_FILE
}

export function requestFileName(id: string): string {
  return `${REQ_PREFIX}${id}.json`
}

export function responseFileName(id: string): string {
  return `${RES_PREFIX}${id}.json`
}
