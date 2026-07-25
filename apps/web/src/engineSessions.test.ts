import { beforeEach, describe, expect, it } from 'vitest'
import {
  listEngineSessions,
  registerEngineSession,
  unregisterEngineSession,
} from './engineSessions'

describe('engineSessions', () => {
  beforeEach(() => {
    for (const s of listEngineSessions()) unregisterEngineSession(s.jobId)
  })

  it('preserves startedAt when re-registering the same job', () => {
    registerEngineSession('job-a', 'Stand')
    const first = listEngineSessions().find((s) => s.jobId === 'job-a')
    expect(first).toBeTruthy()
    const startedAt = first!.startedAt

    registerEngineSession('job-a', 'Stand (renamed)')
    const again = listEngineSessions().find((s) => s.jobId === 'job-a')
    expect(again?.startedAt).toBe(startedAt)
    expect(again?.jobTitle).toBe('Stand (renamed)')
  })

  it('does not list a session after unregister', () => {
    registerEngineSession('job-b', 'Wall')
    unregisterEngineSession('job-b')
    expect(listEngineSessions().find((s) => s.jobId === 'job-b')).toBeUndefined()
  })
})
