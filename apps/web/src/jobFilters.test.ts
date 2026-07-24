import { describe, expect, it } from 'vitest'
import type { Job } from './api'
import { filterJobs, statusClass } from './jobFilters'

function job(partial: Partial<Job> & Pick<Job, 'id' | 'status'>): Job {
  return {
    title: partial.title || partial.id,
    prompt: partial.prompt || '',
    mode: 'fast',
    created_at: partial.created_at || '2026-01-01T12:00:00.000Z',
    updated_at: partial.updated_at || '2026-01-01T12:00:00.000Z',
    tags: partial.tags,
    ...partial,
  }
}

describe('statusClass', () => {
  it('maps terminal and running states', () => {
    expect(statusClass('succeeded')).toBe('ok')
    expect(statusClass('failed')).toBe('bad')
    expect(statusClass('agent_running')).toBe('run')
  })
})

describe('filterJobs', () => {
  const jobs = [
    job({ id: 'a', status: 'succeeded', title: 'Stand', tags: ['demo'] }),
    job({ id: 'b', status: 'failed', title: 'Bracket', prompt: 'corner plate' }),
    job({
      id: 'c',
      status: 'agent_running',
      title: 'Washer',
      created_at: new Date().toISOString(),
    }),
  ]

  it('filters by status and query', () => {
    expect(
      filterJobs(jobs, { query: 'stand', status: 'succeeded', time: 'all' }).map(
        (j) => j.id,
      ),
    ).toEqual(['a'])
    expect(
      filterJobs(jobs, { query: 'corner', status: 'all', time: 'all' }).map((j) => j.id),
    ).toEqual(['b'])
    expect(
      filterJobs(jobs, { query: 'demo', status: 'all', time: 'all' }).map((j) => j.id),
    ).toEqual(['a'])
  })

  it('filters by today', () => {
    const ids = filterJobs(jobs, { query: '', status: 'all', time: 'today' }).map(
      (j) => j.id,
    )
    expect(ids).toEqual(['c'])
  })
})
