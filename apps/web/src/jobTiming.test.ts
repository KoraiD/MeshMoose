import { describe, expect, it } from 'vitest'
import { isJobRunning, jobActiveSeconds } from './jobTiming'

describe('jobActiveSeconds', () => {
  it('sums closed segments without idle time', () => {
    const seconds = jobActiveSeconds(
      {
        status: 'succeeded',
        active_ms: 45_000,
        run_started_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T01:00:00.000Z',
      },
      Date.parse('2026-01-01T01:00:00.000Z'),
    )
    expect(seconds).toBe(45)
  })

  it('adds the open running segment', () => {
    const now = Date.parse('2026-01-01T00:01:30.000Z')
    const seconds = jobActiveSeconds(
      {
        status: 'agent_running',
        active_ms: 30_000,
        run_started_at: '2026-01-01T00:01:00.000Z',
      },
      now,
    )
    expect(seconds).toBe(60)
  })

  it('falls back for jobs without timing fields', () => {
    const seconds = jobActiveSeconds(
      {
        status: 'succeeded',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:02:00.000Z',
      },
      Date.parse('2026-01-01T03:00:00.000Z'),
    )
    expect(seconds).toBe(120)
  })
})

describe('isJobRunning', () => {
  it('detects running statuses', () => {
    expect(isJobRunning('exporting')).toBe(true)
    expect(isJobRunning('succeeded')).toBe(false)
  })
})
