import type { Job } from './api'
import type { EngineSession } from './engineSessions'

const RUNNING = new Set(['queued', 'preprocessing', 'agent_running', 'exporting', 'measuring'])

type Props = {
  open: boolean
  jobs: Job[]
  engineSessions: EngineSession[]
  onClose: () => void
  onNewJob: () => void
  onSelectJob: (id: string) => void
  onDeleteJob: (id: string) => void
  onRetryJob: (id: string) => void
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
  onCancelJob,
  onStopEngine,
}: Props) {
  if (!open) return null
  const running = jobs.filter((j) => RUNNING.has(j.status))
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal jobs-modal" role="dialog" aria-modal="true" aria-labelledby="jobs-modal-title">
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
                    <span className={`pill ${j.status}`}>{j.status}</span>
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
          <h3>All jobs ({jobs.length})</h3>
          {jobs.length ? (
            <ul className="jobs-modal-list">
              {jobs.map((j) => (
                <li key={j.id} className="jobs-modal-row">
                  <button
                    type="button"
                    className="jobs-modal-main"
                    onClick={() => onSelectJob(j.id)}
                  >
                    <span className={`pill ${j.status}`}>{j.status}</span>
                    <span className="jobs-modal-title">{j.title}</span>
                    <span className="muted jobs-modal-meta">
                      {new Date(j.created_at).toLocaleString()}
                    </span>
                  </button>
                  <div className="jobs-modal-actions">
                    {j.status === 'failed' ? (
                      <button
                        type="button"
                        className="job-retry"
                        onClick={() => onRetryJob(j.id)}
                      >
                        Retry
                      </button>
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
            <p className="muted empty">No jobs yet</p>
          )}
        </section>
      </div>
    </div>
  )
}
