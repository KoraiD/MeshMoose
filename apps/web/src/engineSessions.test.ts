import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listEngineSessions,
  registerEngineSession,
  unregisterEngineSession,
} from './engineSessions'

describe('engineSessions', () => {
  beforeEach(() => {
    for (const s of listEngineSessions()) unregisterEngineSession(s.jobId)
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('resets startedAt if unregister runs before re-register (title-change anti-pattern)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-25T12:00:00.000Z'))
    registerEngineSession('job-a', 'Stand')
    const startedAt = listEngineSessions().find((s) => s.jobId === 'job-a')!.startedAt

    unregisterEngineSession('job-a')
    vi.setSystemTime(new Date('2026-07-25T12:00:05.000Z'))
    registerEngineSession('job-a', 'Stand (renamed)')
    const again = listEngineSessions().find((s) => s.jobId === 'job-a')
    expect(again?.jobTitle).toBe('Stand (renamed)')
    expect(again?.startedAt).toBe(startedAt + 5000)
  })

  it('does not list a session after unregister', () => {
    registerEngineSession('job-b', 'Wall')
    unregisterEngineSession('job-b')
    expect(listEngineSessions().find((s) => s.jobId === 'job-b')).toBeUndefined()
  })
})
