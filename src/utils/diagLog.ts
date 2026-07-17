/**
 * Crash / stack-enter diagnostics.
 * - Always console.error
 * - Ring buffer in memory + localStorage (last N entries)
 * - Desktop: best-effort append to %LOCALAPPDATA%/InfiniteCanvas/logs/diag.log
 */

export type DiagLevel = 'info' | 'warn' | 'error'

export type DiagEntry = {
  t: string
  level: DiagLevel
  tag: string
  message: string
  detail?: string
}

const MAX_ENTRIES = 80
const LS_KEY = 'ic2_diag_log'
const ring: DiagEntry[] = []

function nowIso(): string {
  try {
    return new Date().toISOString()
  } catch {
    return String(Date.now())
  }
}

function push(entry: DiagEntry): void {
  ring.push(entry)
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES)
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ring.slice(-40)))
  } catch {
    /* private mode / quota */
  }
  void appendDesktopLog(entry)
}

function formatEntry(e: DiagEntry): string {
  return `[${e.t}] ${e.level.toUpperCase()} ${e.tag}: ${e.message}${
    e.detail ? `\n${e.detail}` : ''
  }`
}

async function appendDesktopLog(entry: DiagEntry): Promise<void> {
  try {
    const desktop =
      typeof window !== 'undefined' &&
      ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
    if (!desktop) return
    const { join, localDataDir } = await import('@tauri-apps/api/path')
    const { exists, mkdir, readTextFile, writeTextFile } = await import(
      '@tauri-apps/plugin-fs'
    )
    const root = await localDataDir()
    const dir = await join(root, 'InfiniteCanvas', 'logs')
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true })
    }
    const file = await join(dir, 'diag.log')
    let prev = ''
    try {
      if (await exists(file)) prev = await readTextFile(file)
    } catch {
      prev = ''
    }
    // Cap file ~256KB
    if (prev.length > 256_000) prev = prev.slice(-128_000)
    await writeTextFile(file, `${prev}${formatEntry(entry)}\n\n`)
  } catch {
    /* best effort — never throw into UI */
  }
}

export function diagLog(
  level: DiagLevel,
  tag: string,
  message: string,
  detail?: unknown,
): void {
  let detailStr: string | undefined
  if (detail !== undefined && detail !== null) {
    if (detail instanceof Error) {
      detailStr = `${detail.name}: ${detail.message}\n${detail.stack || ''}`
    } else if (typeof detail === 'string') {
      detailStr = detail
    } else {
      try {
        detailStr = JSON.stringify(detail, null, 2)
      } catch {
        detailStr = String(detail)
      }
    }
  }
  const entry: DiagEntry = {
    t: nowIso(),
    level,
    tag,
    message,
    detail: detailStr,
  }
  push(entry)
  const line = formatEntry(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}

export function diagInfo(tag: string, message: string, detail?: unknown): void {
  diagLog('info', tag, message, detail)
}

export function diagWarn(tag: string, message: string, detail?: unknown): void {
  diagLog('warn', tag, message, detail)
}

export function diagError(tag: string, message: string, detail?: unknown): void {
  diagLog('error', tag, message, detail)
}

export function getDiagEntries(): DiagEntry[] {
  return ring.slice()
}

export function getDiagText(): string {
  const fromLs: DiagEntry[] = []
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) fromLs.push(...(JSON.parse(raw) as DiagEntry[]))
  } catch {
    /* ignore */
  }
  const merged = [...fromLs, ...ring]
  const seen = new Set<string>()
  const uniq: DiagEntry[] = []
  for (const e of merged) {
    const k = `${e.t}|${e.tag}|${e.message}`
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(e)
  }
  return uniq.map(formatEntry).join('\n\n')
}

/** Install window-level handlers once (safe to call multiple times). */
let globalInstalled = false
export function installGlobalDiagHandlers(): void {
  if (globalInstalled || typeof window === 'undefined') return
  globalInstalled = true

  window.addEventListener('error', (ev) => {
    diagError(
      'window.error',
      ev.message || 'Uncaught error',
      {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        stack: ev.error instanceof Error ? ev.error.stack : String(ev.error),
      },
    )
  })

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason
    diagError(
      'unhandledrejection',
      reason instanceof Error ? reason.message : 'Unhandled promise rejection',
      reason,
    )
  })

  diagInfo('diag', 'Global error handlers installed')
}
