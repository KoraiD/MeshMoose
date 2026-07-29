import { useEffect, useMemo, useState } from 'react'
import type { Job } from './api'
import type { EngineSession } from './engineSessions'
import {
  filterJobs,
  JOB_STATUS_OPTIONS,
  statusClass,
  type JobTimeFilter,
} from './jobFilters'
import { isJobRunning } from './jobTiming'

type Props = {
  open: boolean
  jobs: Job[]
  engineSessions: EngineSession[]
  onClose: () => void
  onNewJob: () => void
  onSelectJob: (id: string) => void
  onDeleteJob: (id: string) => void
  onRetryJob: (id: string) => void
  onResumeJob?: (id: string) => void
  onCancelJob: (id: string) => void
  onStopEngine: (jobId: string) => void
}

function elapsed(startedAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

export function JobsModal({
  open,
  jobs,
  engineSessions,
  onClose,
  onNewJob,
  onSelectJob,
  onDeleteJob,
  onRetryJob,
  onResumeJob,
  onCancelJob,
  onStopEngine,
}: Props) {
  const [jobQuery, setJobQuery] = useState('')
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('all')
  const [jobTimeFilter, setJobTimeFilter] = useState<JobTimeFilter>('all')

  const filteredJobs = useMemo(
    () =>
      filterJobs(jobs, {
        query: jobQuery,
        status: jobStatusFilter,
        time: jobTimeFilter,
      }),
    [jobs, jobQuery, jobStatusFilter, jobTimeFilter],
  )

  const running = useMemo(
    () => filteredJobs.filter((j) => isJobRunning(j.status)),
    [filteredJobs],
  )

  const filtersActive =
    Boolean(jobQuery.trim()) || jobStatusFilter !== 'all' || jobTimeFilter !== 'all'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal jobs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jobs-modal-title"
      >
        <div className="modal-head">
          <h2 id="jobs-modal-title">All jobs</h2>
          <div className="modal-head-actions">
            <button type="button" className="primary" onClick={onNewJob}>
              New job
            </button>
            <button type="button" className="modal-close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="jobs-filters jobs-modal-filters">
          <label className="jobs-filter-search">
            <span className="sr-only">Filter jobs</span>
            <input
              type="search"
              value={jobQuery}
              onChange={(e) => setJobQuery(e.target.value)}
              placeholder="Name, ID, tag…"
            />
          </label>
          <div className="jobs-filter-row">
            <label>
              <span className="sr-only">Status</span>
              <select
                value={jobStatusFilter}
                onChange={(e) => setJobStatusFilter(e.target.value)}
              >
                <option value="all">All states</option>
                {JOB_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Time</span>
              <select
                value={jobTimeFilter}
                onChange={(e) => setJobTimeFilter(e.target.value as JobTimeFilter)}
              >
                <option value="all">Any time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </label>
          </div>
          {filtersActive ? (
            <p className="jobs-filter-meta muted">
              {filteredJobs.length} of {jobs.length}
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setJobQuery('')
                  setJobStatusFilter('all')
                  setJobTimeFilter('all')
                }}
              >
                Clear
              </button>
            </p>
          ) : null}
        </div>

        {running.length ? (
          <section className="jobs-modal-section">
            <h3>In progress ({running.length})</h3>
            <ul className="jobs-modal-list">
              {running.map((j) => (
                <li key={j.id} className="jobs-modal-row">
                  <button
                    type="button"
                    className="jobs-modal-main"
                    onClick={() => onSelectJob(j.id)}
                  >
                    <span className={`pill ${statusClass(j.status)}`}>{j.status}</span>
                    <span className="jobs-modal-title">{j.title}</span>
                    <span className="muted jobs-modal-meta">
                      {j.mode} · started {new Date(j.created_at).toLocaleTimeString()}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="job-cancel"
                    title="Stop this run"
                    onClick={() => onCancelJob(j.id)}
                  >
                    Stop
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {engineSessions.length ? (
          <section className="jobs-modal-section">
            <h3>Live engine sessions ({engineSessions.length})</h3>
            <p className="muted jobs-modal-note">
              Streaming Engine previews use API minutes. Stop any you no longer need.
            </p>
            <ul className="jobs-modal-list">
              {engineSessions.map((s) => (
                <li key={s.jobId} className="jobs-modal-row">
                  <div className="jobs-modal-main as-text">
                    <span className="pill engine">live</span>
                    <span className="jobs-modal-title">{s.jobTitle}</span>
                    <span className="muted jobs-modal-meta">running {elapsed(s.startedAt)}</span>
                  </div>
                  <button
                    type="button"
                    className="job-cancel"
                    title="Stop this engine session"
                    onClick={() => onStopEngine(s.jobId)}
                  >
                    Stop
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="jobs-modal-section">
          <h3>All jobs ({filteredJobs.length})</h3>
          {filteredJobs.length ? (
            <ul className="jobs-modal-list">
              {filteredJobs.map((j) => (
                <li key={j.id} className="jobs-modal-row">
                  <button
                    type="button"
                    className="jobs-modal-main"
                    onClick={() => onSelectJob(j.id)}
                  >
                    <span className={`pill ${statusClass(j.status)}`}>{j.status}</span>
                    <span className="jobs-modal-title">{j.title}</span>
                    {j.tags?.length ? (
                      <span className="job-tags-inline">
                        {j.tags.map((t) => (
                          <span key={t} className="tag-chip tiny">
                            {t}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <span className="muted jobs-modal-meta">
                      {new Date(j.created_at).toLocaleString()}
                    </span>
                  </button>
                  <div className="jobs-modal-actions">
                    {j.status === 'failed' ? (
                      <>
                        {j.has_agent_checkpoint && onResumeJob ? (
                          <button
                            type="button"
                            className="job-retry"
                            title="Continue from Agent draft KCL"
                            onClick={() => onResumeJob(j.id)}
                          >
                            Resume
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="job-retry"
                          onClick={() => onRetryJob(j.id)}
                        >
                          Retry
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="job-delete"
                      onClick={() => onDeleteJob(j.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted empty">
              {!jobs.length ? 'No jobs yet' : 'No jobs match this filter'}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
