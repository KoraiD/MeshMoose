import type { Job } from './api'

export type JobTimeFilter = 'all' | 'today' | '7d' | '30d'

export const JOB_STATUS_OPTIONS = [
  'queued',
  'preprocessing',
  'agent_running',
  'exporting',
  'measuring',
  'succeeded',
  'failed',
] as const

export function statusClass(status: string): string {
  if (status === 'succeeded') return 'ok'
  if (status === 'failed') return 'bad'
  return 'run'
}

export function filterJobs(
  jobs: Job[],
  opts: {
    query: string
    status: string
    time: JobTimeFilter
  },
): Job[] {
  const q = opts.query.trim().toLowerCase()
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  return jobs.filter((j) => {
    if (opts.status !== 'all' && j.status !== opts.status) return false
    if (opts.time !== 'all') {
      const created = Date.parse(j.created_at)
      if (Number.isNaN(created)) return false
      if (opts.time === 'today') {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        if (created < start.getTime()) return false
      } else if (opts.time === '7d') {
        if (created < now - 7 * dayMs) return false
      } else if (opts.time === '30d') {
        if (created < now - 30 * dayMs) return false
      }
    }
    if (!q) return true
    const hay = [j.title, j.id, j.status, j.prompt, ...(j.tags || [])]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}
