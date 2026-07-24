/** Registry of live Zoo Engine (WebRTC) sessions so the Jobs panel can list
 * and stop them. The engine burns API minutes while connected, so visibility
 * into what's still running matters.
 */

export type EngineSession = {
  jobId: string
  jobTitle: string
  startedAt: number
}

const sessions = new Map<string, EngineSession>()
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

export function registerEngineSession(jobId: string, jobTitle: string): void {
  const existing = sessions.get(jobId)
  sessions.set(jobId, {
    jobId,
    jobTitle,
    startedAt: existing?.startedAt ?? Date.now(),
  })
  emit()
}

export function unregisterEngineSession(jobId: string): void {
  if (sessions.delete(jobId)) emit()
}

export function listEngineSessions(): EngineSession[] {
  return [...sessions.values()].sort((a, b) => a.startedAt - b.startedAt)
}

export function subscribeEngineSessions(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
