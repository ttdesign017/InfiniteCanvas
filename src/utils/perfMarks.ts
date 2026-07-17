/**
 * Lightweight performance marks for save/open hot paths.
 * Safe in production — measures only log when `localStorage.ic2_perf === '1'`
 * or when import.meta.env.DEV is true.
 */

const PREFIX = 'ic2:'

function shouldLog(): boolean {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') {
    return false
  }
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('ic2_perf') === '1') {
      return true
    }
  } catch {
    /* private mode */
  }
  try {
    // Vite defines import.meta.env.DEV; avoid hard dependency on vite client types
    const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env
    return Boolean(env?.DEV)
  } catch {
    return false
  }
}

export function perfMark(name: string): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  try {
    performance.mark(`${PREFIX}${name}`)
  } catch {
    /* ignore */
  }
}

/** Measure start→end marks; returns duration ms or null. */
export function perfMeasure(
  label: string,
  startName: string,
  endName: string,
): number | null {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') {
    return null
  }
  const start = `${PREFIX}${startName}`
  const end = `${PREFIX}${endName}`
  try {
    const measureName = `${PREFIX}${label}`
    performance.measure(measureName, start, end)
    const entries = performance.getEntriesByName(measureName)
    const last = entries[entries.length - 1]
    const ms = last?.duration ?? null
    if (ms != null && shouldLog()) {
      console.info(`[ic2 perf] ${label}: ${ms.toFixed(1)}ms`)
    }
    performance.clearMarks(start)
    performance.clearMarks(end)
    performance.clearMeasures(measureName)
    return ms
  } catch {
    return null
  }
}
