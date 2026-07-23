import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  clearApiToken,
  getApiToken,
  getZooUsage,
  setApiToken,
  type ZooUsage,
} from './api'
import {
  appLog,
  clearAppLogs,
  getAppLogs,
  subscribeAppLogs,
  type AppLogEntry,
  type AppLogLevel,
} from './appLog'
import {
  deletePromptTemplate,
  listPromptTemplates,
  savePromptTemplate,
  type PromptTemplate,
} from './promptTemplates'
import {
  applyTheme,
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from './theme'

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

export function SettingsModal({ open, onClose, onTokenChange }: Props) {
  const [token, setToken] = useState(getApiToken())
  const [saved, setSaved] = useState(Boolean(getApiToken()))
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference())
  const [logs, setLogs] = useState<AppLogEntry[]>(() => getAppLogs())
  const [logFilter, setLogFilter] = useState<'all' | AppLogLevel>('all')
  const [usage, setUsage] = useState<ZooUsage | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplate[]>(() =>
    listPromptTemplates(),
  )
  const [tplTitle, setTplTitle] = useState('')
  const [tplPrompt, setTplPrompt] = useState('')
  const [tplEditId, setTplEditId] = useState<string | null>(null)
  const [tplError, setTplError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setToken(getApiToken())
    setSaved(Boolean(getApiToken()))
    setTheme(getThemePreference())
    setLogs(getAppLogs())
    setTemplates(listPromptTemplates())
    setTplTitle('')
    setTplPrompt('')
    setTplEditId(null)
    setTplError(null)
  }, [open])

  useEffect(() => {
    return subscribeAppLogs(() => setLogs(getAppLogs()))
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
    if (!open || !getApiToken()) {
      setUsage(null)
      setUsageError(null)
      return
    }
    let cancelled = false
    setUsageLoading(true)
    setUsageError(null)
    void getZooUsage()
      .then((data) => {
        if (!cancelled) {
          setUsage(data)
          appLog('Fetched Zoo API usage for Settings')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setUsage(null)
          setUsageError((err as Error).message)
        }
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, saved, token])

  const filtered = useMemo(() => {
    const list = [...logs].reverse()
    if (logFilter === 'all') return list
    return list.filter((e) => e.level === logFilter)
  }, [logs, logFilter])

  if (!open) return null

  function onSaveKey(e: FormEvent) {
    e.preventDefault()
    setApiToken(token)
    setSaved(true)
    onTokenChange(token.trim())
    appLog('API token updated from Settings')
  }

  function onClearKey() {
    clearApiToken()
    setToken('')
    setSaved(false)
    onTokenChange('')
    setUsage(null)
    appLog('API token cleared from Settings', 'warn')
  }

  function onTheme(next: ThemePreference) {
    setTheme(next)
    setThemePreference(next)
    applyTheme(next)
    appLog(`Theme set to ${next}`)
  }

  function refreshUsage() {
    if (!getApiToken()) return
    setUsageLoading(true)
    setUsageError(null)
    void getZooUsage()
      .then((data) => {
        setUsage(data)
        appLog('Refreshed Zoo API usage')
      })
      .catch((err) => {
        setUsage(null)
        setUsageError((err as Error).message)
      })
      .finally(() => setUsageLoading(false))
  }

  const bal = usage?.balance

  function onSaveTemplate(e: FormEvent) {
    e.preventDefault()
    setTplError(null)
    try {
      savePromptTemplate({
        id: tplEditId || undefined,
        title: tplTitle,
        prompt: tplPrompt,
      })
      setTemplates(listPromptTemplates())
      setTplTitle('')
      setTplPrompt('')
      setTplEditId(null)
      appLog(
        tplEditId
          ? `Updated prompt template “${tplTitle.trim()}”`
          : `Saved prompt template “${tplTitle.trim()}”`,
      )
    } catch (err) {
      setTplError((err as Error).message)
    }
  }

  function onEditTemplate(t: PromptTemplate) {
    if (t.builtin) return
    setTplEditId(t.id)
    setTplTitle(t.title)
    setTplPrompt(t.prompt)
    setTplError(null)
  }

  function onDeleteTemplate(id: string) {
    try {
      deletePromptTemplate(id)
      setTemplates(listPromptTemplates())
      if (tplEditId === id) {
        setTplEditId(null)
        setTplTitle('')
        setTplPrompt('')
      }
      appLog('Deleted custom prompt template', 'warn')
    } catch (err) {
      setTplError((err as Error).message)
    }
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
        aria-labelledby="settings-title"
      >
        <div className="modal-head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="settings-section">
          <h3>Appearance</h3>
          <p className="muted">
            Light and dark themes inspired by modern CAD tooling — clean surfaces,
            precise type, restrained accent.
          </p>
          <div className="theme-pills" role="group" aria-label="Color theme">
            {(
              [
                ['light', 'Light'],
                ['dark', 'Dark'],
                ['system', 'System'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={theme === id ? 'active' : ''}
                onClick={() => onTheme(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>Zoo API token</h3>
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
            <h3>Zoo API usage</h3>
            <button
              type="button"
              onClick={refreshUsage}
              disabled={!saved || usageLoading}
            >
              {usageLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <p className="muted">
            Live from Zoo’s free account endpoints (`/user/payment/balance`, recent
            `/user/api-calls`). Billable work is metered by the second.
          </p>
          {!saved ? (
            <p className="muted">Save an API token to load usage.</p>
          ) : usageError ? (
            <div className="banner bad">{usageError}</div>
          ) : usageLoading && !usage ? (
            <p className="muted">Loading Zoo usage…</p>
          ) : usage && bal ? (
            <>
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

        <section className="settings-section">
          <h3>Prompt templates</h3>
          <p className="muted">
            Built-in starters (washer, bracket, coin) ship with the app. Save your own
            short prompts for New job — each has a title and body.
          </p>
          <ul className="template-list">
            {templates.map((t) => (
              <li key={t.id}>
                <div>
                  <strong>{t.title}</strong>
                  {t.builtin ? <span className="muted"> · built-in</span> : null}
                  <p className="muted template-preview">{t.prompt}</p>
                </div>
                {!t.builtin ? (
                  <div className="template-list-actions">
                    <button type="button" className="linkish" onClick={() => onEditTemplate(t)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => onDeleteTemplate(t.id)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <form className="template-form" onSubmit={onSaveTemplate}>
            <label className="template-field">
              <span className="template-field-label">Title</span>
              <input
                value={tplTitle}
                onChange={(e) => setTplTitle(e.target.value.slice(0, 80))}
                placeholder="e.g. Thin flange"
                required
                maxLength={80}
              />
              <span className="template-field-meta">
                {tplTitle.length} / 80
              </span>
            </label>
            <label className="template-field">
              <span className="template-field-label">Prompt</span>
              <textarea
                value={tplPrompt}
                onChange={(e) => setTplPrompt(e.target.value.slice(0, 8000))}
                rows={5}
                required
                maxLength={8000}
                placeholder="Short reconstruction instructions…"
              />
              <span className="template-field-meta">
                {tplPrompt.length} / 8000
              </span>
            </label>
            {tplError ? <div className="banner bad">{tplError}</div> : null}
            <div className="settings-key-actions">
              <button type="submit" className="primary">
                {tplEditId ? 'Update template' : 'Save template'}
              </button>
              {tplEditId ? (
                <button
                  type="button"
                  onClick={() => {
                    setTplEditId(null)
                    setTplTitle('')
                    setTplPrompt('')
                  }}
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="settings-section">
          <div className="settings-log-head">
            <h3>App log</h3>
            <button type="button" onClick={() => clearAppLogs()} disabled={!logs.length}>
              Clear log
            </button>
          </div>
          <p className="muted">
            Local client events (errors, job actions, settings). Job Agent logs stay on
            each job’s Workbench tab.
          </p>
          <div className="log-filters">
            {(['all', 'debug', 'info', 'warn', 'error'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={logFilter === f ? 'active' : ''}
                onClick={() => setLogFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="app-log-panel" role="log">
            {filtered.length ? (
              filtered.map((entry) => (
                <div key={entry.id} className={`log-line ${entry.level}`}>
                  <span className="ts">{entry.ts.slice(11, 19)}</span>
                  <span className="lvl">{entry.level.toUpperCase()}</span>
                  <span className="msg">{entry.message}</span>
                </div>
              ))
            ) : (
              <p className="muted empty">No app log entries yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
