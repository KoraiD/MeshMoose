/** In-memory Zoo usage cache + optional 10-minute auto-refresh. */

import { getApiToken, getZooUsage, type ZooUsage } from './api'
import { appLog } from './appLog'

const AUTO_KEY = 'meshmoose.zooUsageAutoRefresh'
export const ZOO_USAGE_AUTO_INTERVAL_MS = 10 * 60 * 1000

export type ZooUsageState = {
  usage: ZooUsage | null
  /** Epoch ms of last successful fetch. */
  lastFetchedAt: number | null
  error: string | null
  loading: boolean
  autoRefresh: boolean
}

let state: ZooUsageState = {
  usage: null,
  lastFetchedAt: null,
  error: null,
  loading: false,
  autoRefresh: readAutoRefresh(),
}

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let inFlight: Promise<void> | null = null

function readAutoRefresh(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === '1'
  } catch {
    return false
  }
}

function emit() {
  for (const fn of listeners) fn()
}

function setState(patch: Partial<ZooUsageState>) {
  state = { ...state, ...patch }
  emit()
}

export function getZooUsageState(): ZooUsageState {
  return state
}

export function subscribeZooUsage(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setZooUsageAutoRefresh(enabled: boolean): void {
  localStorage.setItem(AUTO_KEY, enabled ? '1' : '0')
  setState({ autoRefresh: enabled })
  syncZooUsagePolling()
  if (enabled && getApiToken()) {
    void refreshZooUsage({ reason: 'auto-enable' })
  }
  appLog(
    enabled
      ? 'Zoo usage auto-refresh enabled (every 10 minutes)'
      : 'Zoo usage auto-refresh disabled',
  )
}

export function clearZooUsageCache(): void {
  setState({
    usage: null,
    lastFetchedAt: null,
    error: null,
    loading: false,
  })
  syncZooUsagePolling()
}

export async function refreshZooUsage(opts?: {
  reason?: string
}): Promise<void> {
  if (!getApiToken()) {
    setState({ loading: false, error: 'Save an API token to load usage.' })
    return
  }
  if (inFlight) return inFlight

  setState({ loading: true, error: null })
  inFlight = getZooUsage()
    .then((data) => {
      setState({
        usage: data,
        lastFetchedAt: Date.now(),
        error: null,
        loading: false,
      })
      if (opts?.reason === 'manual') appLog('Refreshed Zoo API usage')
      else if (opts?.reason === 'auto' || opts?.reason === 'auto-enable') {
        appLog('Auto-refreshed Zoo API usage')
      } else {
        appLog('Fetched Zoo API usage')
      }
    })
    .catch((err) => {
      // Keep prior metrics in memory so the UI still has something to show.
      setState({
        error: (err as Error).message,
        loading: false,
      })
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

export function syncZooUsagePolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (!state.autoRefresh || !getApiToken()) return
  timer = setInterval(() => {
    if (!getApiToken() || !state.autoRefresh) return
    void refreshZooUsage({ reason: 'auto' })
  }, ZOO_USAGE_AUTO_INTERVAL_MS)
}

/** Start/stop the interval and fetch once if auto-refresh is on but cache is empty. */
export function ensureZooUsageAutoRefresh(): void {
  syncZooUsagePolling()
  if (!state.autoRefresh || !getApiToken()) return
  if (!state.usage || !state.lastFetchedAt) {
    void refreshZooUsage({ reason: 'auto' })
  }
}

/** Test helper: reset module state between cases. */
export function resetZooUsageStoreForTests(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  inFlight = null
  state = {
    usage: null,
    lastFetchedAt: null,
    error: null,
    loading: false,
    autoRefresh: readAutoRefresh(),
  }
  listeners.clear()
}

export function formatUsageUpdatedAt(ms: number | null): string {
  if (ms == null) return 'Never'
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return new Date(ms).toISOString()
  }
}
