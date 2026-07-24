/** Active job runtime: only counts periods while the pipeline is running. */

const RUNNING = new Set([
  'queued',
  'preprocessing',
  'agent_running',
  'exporting',
  'measuring',
])

export type TimedJob = {
  status: string
  created_at?: string
  updated_at?: string
  /** Cumulative ms spent in running statuses (server-tracked). */
  active_ms?: number | null
  /** When the current running segment started, if any. */
  run_started_at?: string | null
}

export function isJobRunning(status: string): boolean {
  return RUNNING.has(status)
}

/**
 * Seconds of active work for a job.
 * Prefers server `active_ms` + open `run_started_at` segment.
 * Falls back to wall-clock created→updated for older jobs without timing fields.
 */
export function jobActiveSeconds(job: TimedJob | null | undefined, nowMs: number): number | null {
  if (!job) return null

  const hasTiming = job.active_ms != null || job.run_started_at != null
  if (hasTiming) {
    let ms = Math.max(0, Number(job.active_ms) || 0)
    if (isJobRunning(job.status) && job.run_started_at) {
      const start = Date.parse(job.run_started_at)
      if (!Number.isNaN(start)) ms += Math.max(0, nowMs - start)
    }
    return ms / 1000
  }

  if (!job.created_at) return null
  const start = Date.parse(job.created_at)
  if (Number.isNaN(start)) return null
  const end =
    job.status === 'succeeded' || job.status === 'failed'
      ? Date.parse(job.updated_at || job.created_at)
      : nowMs
  if (Number.isNaN(end)) return null
  return Math.max(0, (end - start) / 1000)
}
