export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type AppLogEntry = {
  id: string
  ts: string
  level: AppLogLevel
  message: string
}

const KEY = 'meshmoose.appLog'
const MAX = 200
const listeners = new Set<() => void>()

function load(): AppLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AppLogEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function save(entries: AppLogEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX)))
  for (const fn of listeners) fn()
}

export function getAppLogs(): AppLogEntry[] {
  return load()
}

export function clearAppLogs(): void {
  localStorage.removeItem(KEY)
  for (const fn of listeners) fn()
}

export function subscribeAppLogs(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function appLog(message: string, level: AppLogLevel = 'info'): void {
  const entry: AppLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    level,
    message,
  }
  const next = [...load(), entry].slice(-MAX)
  save(next)
  if (level === 'error') {
    console.error('[meshmoose]', message)
  } else if (level === 'warn') {
    console.warn('[meshmoose]', message)
  } else if (level === 'debug') {
    console.debug('[meshmoose]', message)
  }
}
