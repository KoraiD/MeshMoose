import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { clearApiToken, getApiToken, setApiToken } from './api'
import { appLog } from './appLog'
import {
  clearZooUsageCache,
  formatUsageUpdatedAt,
  getZooUsageState,
  refreshZooUsage,
  setZooUsageAutoRefresh,
  subscribeZooUsage,
  syncZooUsagePolling,
} from './zooUsageStore'

type Props = {
  open: boolean
  onClose: () => void
  onTokenChange: (token: string) => void
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `$${n.toFixed(2)}`
}

function credits(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString()
}

function shortEndpoint(path: string | undefined): string {
  if (!path) return '—'
  if (path.includes('/ws/ml/copilot')) return 'Agent (copilot)'
  if (path.includes('/ws/modeling/commands')) return 'Engine (modeling)'
  if (path.startsWith('/file/')) return `File ${path.replace('/file/', '')}`
  return path.length > 42 ? `${path.slice(0, 40)}…` : path
}

export function ApiAccountModal({ open, onClose, onTokenChange }: Props) {
  const [token, setToken] = useState(getApiToken())
  const [saved, setSaved] = useState(Boolean(getApiToken()))
  const [usageState, setUsageState] = useState(() => getZooUsageState())

  useEffect(() => {
    if (!open) return
    setToken(getApiToken())
    setSaved(Boolean(getApiToken()))
  }, [open])

  useEffect(() => {
    return subscribeZooUsage(() => setUsageState(getZooUsageState()))
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !getApiToken()) return
    // Show cached metrics immediately; refresh if we have none yet.
    if (!getZooUsageState().usage) {
      void refreshZooUsage()
    }
  }, [open, saved, token])

  if (!open) return null

  const { usage, lastFetchedAt, error: usageError, loading: usageLoading, autoRefresh } =
    usageState
  const bal = usage?.balance

  function onSaveKey(e: FormEvent) {
    e.preventDefault()
    setApiToken(token)
    setSaved(true)
    onTokenChange(token.trim())
    appLog('API token updated')
    syncZooUsagePolling()
    void refreshZooUsage()
  }

  function onClearKey() {
    clearApiToken()
    setToken('')
    setSaved(false)
    onTokenChange('')
    clearZooUsageCache()
    appLog('API token cleared', 'warn')
  }

  function refreshUsage() {
    void refreshZooUsage({ reason: 'manual' })
  }

  function onToggleAuto(next: boolean) {
    setZooUsageAutoRefresh(next)
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-account-title"
      >
        <div className="modal-head">
          <h2 id="api-account-title">Zoo API</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="settings-section">
          <h3>API token</h3>
          <p className="muted">
            Stored only in this browser’s localStorage. The local API forwards it as
            Bearer auth and never writes it to disk.
          </p>
          <form className="settings-key-form" onSubmit={onSaveKey}>
            <label>
              Token
              <input
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  setSaved(false)
                }}
                placeholder="api-…"
                autoComplete="off"
              />
            </label>
            <div className="settings-key-actions">
              <button type="submit" className={`primary${saved ? ' saved' : ''}`}>
                {saved ? 'Key saved' : 'Save key'}
              </button>
              <button type="button" onClick={onClearKey} disabled={!token && !saved}>
                Clear
              </button>
            </div>
          </form>
        </section>

        <section className="settings-section">
          <div className="settings-log-head">
            <h3>Usage</h3>
            <button type="button" onClick={refreshUsage} disabled={!saved || usageLoading}>
              {usageLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <p className="muted">
            Live from Zoo’s free account endpoints (`/user/payment/balance`, recent
            `/user/api-calls`). Billable work is metered by the second.
          </p>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={autoRefresh}
              disabled={!saved}
              onChange={(e) => onToggleAuto(e.target.checked)}
            />
            Auto-refresh every 10 minutes while the app is open
          </label>
          <p className="hint usage-updated">
            Last updated: {formatUsageUpdatedAt(lastFetchedAt)}
            {autoRefresh && saved ? ' · auto every 10 min' : ''}
            {usageLoading && usage ? ' · refreshing…' : ''}
          </p>
          {!saved ? (
            <p className="muted">Save an API token to load usage.</p>
          ) : usageError && !usage ? (
            <div className="banner bad">{usageError}</div>
          ) : usageLoading && !usage ? (
            <p className="muted">Loading Zoo usage…</p>
          ) : usage && bal ? (
            <>
              {usageError ? (
                <div className="banner bad">
                  Refresh failed: {usageError}. Showing last successful metrics.
                </div>
              ) : null}
              <div className="usage-grid">
                <div className="usage-card">
                  <span>Plan</span>
                  <strong>{bal.plan_name || '—'}</strong>
                </div>
                <div className="usage-card">
                  <span>Monthly credits left</span>
                  <strong>
                    {credits(bal.monthly_api_credits_remaining)}
                    <em> · {money(bal.monthly_api_credits_remaining_monetary_value)}</em>
                  </strong>
                </div>
                <div className="usage-card">
                  <span>Monthly included</span>
                  <strong>
                    {credits(bal.monthly_included_credits)}
                    <em> · {money(bal.monthly_included_monetary_value)}</em>
                  </strong>
                </div>
                <div className="usage-card">
                  <span>Stable credits</span>
                  <strong>
                    {credits(bal.stable_api_credits_remaining)}
                    <em> · {money(bal.stable_api_credits_remaining_monetary_value)}</em>
                  </strong>
                </div>
                <div className="usage-card">
                  <span>Pay-as-you-go rate</span>
                  <strong>
                    {bal.pay_as_you_go_credit_price != null
                      ? `$${bal.pay_as_you_go_credit_price}/s`
                      : '—'}
                  </strong>
                </div>
                <div className="usage-card">
                  <span>Recent sample</span>
                  <strong>
                    {usage.recent_totals.count} calls · {usage.recent_totals.seconds}s ·{' '}
                    {money(usage.recent_totals.price)}
                  </strong>
                </div>
              </div>
              {usage.pricing_note ? (
                <p className="hint usage-note">{usage.pricing_note}</p>
              ) : null}
              {usage.recent_calls.length ? (
                <div className="usage-calls">
                  <h4>Recent API calls</h4>
                  <ul>
                    {usage.recent_calls.map((c) => (
                      <li key={c.id || `${c.created_at}-${c.endpoint}`}>
                        <span className="usage-call-ep">{shortEndpoint(c.endpoint)}</span>
                        <span className="usage-call-meta">
                          {c.seconds ?? 0}s · {money(c.price)} ·{' '}
                          {c.created_at?.slice(11, 19) || '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted">No usage data yet.</p>
          )}
        </section>
      </div>
    </div>
  )
}
