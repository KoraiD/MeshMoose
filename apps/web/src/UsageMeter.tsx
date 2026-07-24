import { useEffect, useState } from 'react'
import { getApiToken } from './api'
import {
  formatUsageUpdatedAt,
  getZooUsageState,
  refreshZooUsage,
  subscribeZooUsage,
} from './zooUsageStore'

type Props = {
  /** Local session seconds (e.g. live engine connection). */
  sessionSeconds?: number | null
  /** Job active seconds (running pipeline time only). */
  jobSeconds?: number | null
  refreshKey?: string | number | boolean
  compact?: boolean
}

function fmtSeconds(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || n < 0) return '—'
  if (n < 60) return `${Math.round(n)}s`
  const m = Math.floor(n / 60)
  const s = Math.round(n % 60)
  return `${m}m ${s}s`
}

export function UsageMeter({
  sessionSeconds,
  jobSeconds,
  refreshKey,
  compact,
}: Props) {
  const [usageState, setUsageState] = useState(() => getZooUsageState())

  useEffect(() => {
    return subscribeZooUsage(() => setUsageState(getZooUsageState()))
  }, [])

  useEffect(() => {
    if (!getApiToken()) return
    // Prefer in-memory cache; only fetch when empty (auto-refresh keeps it warm).
    if (!getZooUsageState().usage) {
      void refreshZooUsage()
    }
  }, [refreshKey])

  const recent = usageState.usage?.recent_totals

  return (
    <div className={`usage-meter${compact ? ' compact' : ''}`}>
      <div className="usage-meter-grid">
        <div>
          <span>Active time</span>
          <strong>{fmtSeconds(jobSeconds)}</strong>
        </div>
        {sessionSeconds != null ? (
          <div>
            <span>Engine session</span>
            <strong className={sessionSeconds > 0 ? 'hot' : ''}>
              {fmtSeconds(sessionSeconds)}
            </strong>
          </div>
        ) : null}
        <div>
          <span>Recent Zoo calls</span>
          <strong>{recent ? recent.count : '—'}</strong>
        </div>
        <div>
          <span>Recent Zoo time</span>
          <strong>{recent ? `${recent.seconds}s` : '—'}</strong>
        </div>
        <div>
          <span>Recent Zoo cost</span>
          <strong>
            {recent != null ? `$${recent.price.toFixed(2)}` : '—'}
          </strong>
        </div>
      </div>
      <p className="hint">
        Zoo meters most billable work by the second. Recent sample is from your account
        (last ~dozen calls), not this job alone. Updated{' '}
        {formatUsageUpdatedAt(usageState.lastFetchedAt).toLowerCase()}.
      </p>
      {usageState.error ? (
        <p className="usage-meter-error">{usageState.error}</p>
      ) : null}
    </div>
  )
}
