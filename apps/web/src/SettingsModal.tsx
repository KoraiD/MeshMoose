import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  appLog,
  clearAppLogs,
  getAppLogs,
  subscribeAppLogs,
  type AppLogEntry,
  type AppLogLevel,
} from './appLog'
import {
  ensureNotificationPermission,
  getJobNotificationsEnabled,
  notificationPermission,
  setJobNotificationsEnabled,
} from './jobNotifications'
import {
  deletePromptTemplate,
  listPromptTemplates,
  savePromptTemplate,
  type PromptTemplate,
} from './promptTemplates'
import {
  deleteRefineSnippet,
  listRefineSnippets,
  REFINE_PROMPT_MAX,
  REFINE_SNIPPET_MAX_MESHES,
  REFINE_SNIPPET_MAX_PHOTOS,
  REFINE_TITLE_MAX,
  saveRefineSnippet,
  type RefineSnippet,
} from './refineSnippets'
import {
  addTagToLibrary,
  isDefaultTag,
  listTags,
  MAX_TAG_LEN,
  removeTagFromLibrary,
} from './tagLibrary'
import {
  applyTheme,
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from './theme'

type Props = {
  open: boolean
  onClose: () => void
  onLibraryChange?: () => void
}

export function SettingsModal({ open, onClose, onLibraryChange }: Props) {
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference())
  const [logs, setLogs] = useState<AppLogEntry[]>(() => getAppLogs())
  const [logFilter, setLogFilter] = useState<'all' | AppLogLevel>('all')
  const [templates, setTemplates] = useState<PromptTemplate[]>(() =>
    listPromptTemplates(),
  )
  const [tplTitle, setTplTitle] = useState('')
  const [tplPrompt, setTplPrompt] = useState('')
  const [tplEditId, setTplEditId] = useState<string | null>(null)
  const [tplError, setTplError] = useState<string | null>(null)

  const [tags, setTags] = useState<string[]>(() => listTags())
  const [tagDraft, setTagDraft] = useState('')
  const [tagError, setTagError] = useState<string | null>(null)

  const [snippets, setSnippets] = useState<RefineSnippet[]>([])
  const [snipTitle, setSnipTitle] = useState('')
  const [snipPrompt, setSnipPrompt] = useState('')
  const [snipEditId, setSnipEditId] = useState<string | null>(null)
  const [snipPhotos, setSnipPhotos] = useState<FileList | null>(null)
  const [snipMeshes, setSnipMeshes] = useState<FileList | null>(null)
  const [snipError, setSnipError] = useState<string | null>(null)
  const [snipBusy, setSnipBusy] = useState(false)

  const [notifyJobs, setNotifyJobs] = useState(() => getJobNotificationsEnabled())
  const [notifyPerm, setNotifyPerm] = useState(() => notificationPermission())
  const [notifyError, setNotifyError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTheme(getThemePreference())
    setLogs(getAppLogs())
    setTemplates(listPromptTemplates())
    setTags(listTags())
    setTagDraft('')
    setTagError(null)
    setTplTitle('')
    setTplPrompt('')
    setTplEditId(null)
    setTplError(null)
    setSnipTitle('')
    setSnipPrompt('')
    setSnipEditId(null)
    setSnipPhotos(null)
    setSnipMeshes(null)
    setSnipError(null)
    setNotifyJobs(getJobNotificationsEnabled())
    setNotifyPerm(notificationPermission())
    setNotifyError(null)
    void listRefineSnippets().then(setSnippets).catch(() => setSnippets([]))
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

  const filtered = useMemo(() => {
    const list = [...logs].reverse()
    if (logFilter === 'all') return list
    return list.filter((e) => e.level === logFilter)
  }, [logs, logFilter])

  if (!open) return null

  function onTheme(next: ThemePreference) {
    setTheme(next)
    setThemePreference(next)
    applyTheme(next)
    appLog(`Theme set to ${next}`)
  }

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
      onLibraryChange?.()
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
      onLibraryChange?.()
    } catch (err) {
      setTplError((err as Error).message)
    }
  }

  function onAddTag(e: FormEvent) {
    e.preventDefault()
    setTagError(null)
    try {
      addTagToLibrary(tagDraft)
      setTags(listTags())
      setTagDraft('')
      onLibraryChange?.()
    } catch (err) {
      setTagError((err as Error).message)
    }
  }

  function onRemoveTag(tag: string) {
    setTagError(null)
    try {
      removeTagFromLibrary(tag)
      setTags(listTags())
      onLibraryChange?.()
    } catch (err) {
      setTagError((err as Error).message)
    }
  }

  async function onSaveSnippet(e: FormEvent) {
    e.preventDefault()
    setSnipError(null)
    setSnipBusy(true)
    try {
      const photos = snipPhotos ? Array.from(snipPhotos) : undefined
      const meshes = snipMeshes ? Array.from(snipMeshes) : undefined
      await saveRefineSnippet({
        id: snipEditId || undefined,
        title: snipTitle,
        prompt: snipPrompt,
        photos,
        meshes,
        keepExistingFiles: Boolean(snipEditId) && !photos && !meshes,
      })
      setSnippets(await listRefineSnippets())
      setSnipTitle('')
      setSnipPrompt('')
      setSnipEditId(null)
      setSnipPhotos(null)
      setSnipMeshes(null)
      appLog(
        snipEditId
          ? `Updated refine snippet “${snipTitle.trim()}”`
          : `Saved refine snippet “${snipTitle.trim()}”`,
      )
      onLibraryChange?.()
    } catch (err) {
      setSnipError((err as Error).message)
    } finally {
      setSnipBusy(false)
    }
  }

  function onEditSnippet(s: RefineSnippet) {
    if (s.builtin) return
    setSnipEditId(s.id)
    setSnipTitle(s.title)
    setSnipPrompt(s.prompt)
    setSnipPhotos(null)
    setSnipMeshes(null)
    setSnipError(null)
  }

  async function onDeleteSnippet(id: string) {
    setSnipError(null)
    try {
      await deleteRefineSnippet(id)
      setSnippets(await listRefineSnippets())
      if (snipEditId === id) {
        setSnipEditId(null)
        setSnipTitle('')
        setSnipPrompt('')
      }
      appLog('Deleted custom refine snippet', 'warn')
      onLibraryChange?.()
    } catch (err) {
      setSnipError((err as Error).message)
    }
  }

  async function onToggleNotify(next: boolean) {
    setNotifyError(null)
    if (next) {
      if (notificationPermission() === 'unsupported') {
        setNotifyError('This browser does not support notifications.')
        setNotifyJobs(false)
        setJobNotificationsEnabled(false)
        return
      }
      const ok = await ensureNotificationPermission()
      setNotifyPerm(notificationPermission())
      if (!ok) {
        setNotifyError('Notification permission was not granted.')
        setNotifyJobs(false)
        setJobNotificationsEnabled(false)
        return
      }
    }
    setNotifyJobs(next)
    setJobNotificationsEnabled(next)
    appLog(next ? 'Job notifications enabled' : 'Job notifications disabled')
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
          <h3>Job notifications</h3>
          <p className="muted">
            Browser notifications when a job succeeds or fails — useful when running
            several jobs in parallel. Permission is requested when you enable this.
            Some browsers quiet OS banners while this tab is focused; check
            Notification Center if you miss one.
          </p>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={notifyJobs}
              onChange={(e) => void onToggleNotify(e.target.checked)}
            />
            Notify when jobs finish
          </label>
          {notifyPerm === 'denied' ? (
            <p className="hint warn">
              Notifications are blocked in the browser. Allow them for this site to
              enable alerts.
            </p>
          ) : null}
          {notifyError ? <div className="banner bad">{notifyError}</div> : null}
        </section>

        <section className="settings-section">
          <h3>Tags</h3>
          <p className="muted">
            Shared tag vocabulary for jobs (max {MAX_TAG_LEN} characters). Defaults
            ship with the app; add your own here. When tagging a job you can still type a
            new value — it is added to this list automatically.
          </p>
          <ul className="tag-library-list">
            {tags.map((t) => (
              <li key={t}>
                <span className="tag-chip tiny">{t}</span>
                {isDefaultTag(t) ? (
                  <span className="muted">built-in</span>
                ) : (
                  <button type="button" className="linkish" onClick={() => onRemoveTag(t)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form className="tag-add-form settings-tag-form" onSubmit={onAddTag}>
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value.slice(0, MAX_TAG_LEN))}
              placeholder="New tag"
              maxLength={MAX_TAG_LEN}
              aria-label="New library tag"
            />
            <button type="submit" className="primary" disabled={!tagDraft.trim()}>
              Add tag
            </button>
          </form>
          {tagError ? <div className="banner bad">{tagError}</div> : null}
        </section>

        <section className="settings-section">
          <h3>Prompt templates</h3>
          <p className="muted">
            Built-in starters ship with the app. Save your own short prompts for New job —
            each has a title and body.
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
              <span className="template-field-meta">{tplTitle.length} / 80</span>
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
              <span className="template-field-meta">{tplPrompt.length} / 8000</span>
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
          <h3>Refine snippets</h3>
          <p className="muted">
            Reusable refine instructions (max {REFINE_PROMPT_MAX} characters). Optionally
            attach up to {REFINE_SNIPPET_MAX_PHOTOS} photos and {REFINE_SNIPPET_MAX_MESHES}{' '}
            meshes (32 MB each). Custom attachments are stored in this browser.
          </p>
          <ul className="template-list">
            {snippets.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.title}</strong>
                  {s.builtin ? <span className="muted"> · built-in</span> : null}
                  {s.attach || s.hasFiles ? (
                    <span className="muted">
                      {' '}
                      · package
                      {s.photoCount || s.meshCount
                        ? ` (${s.photoCount || 0} photo / ${s.meshCount || 0} mesh)`
                        : ''}
                    </span>
                  ) : null}
                  <p className="muted template-preview">{s.prompt}</p>
                </div>
                {!s.builtin ? (
                  <div className="template-list-actions">
                    <button type="button" className="linkish" onClick={() => onEditSnippet(s)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => void onDeleteSnippet(s.id)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <form className="template-form" onSubmit={(e) => void onSaveSnippet(e)}>
            <label className="template-field">
              <span className="template-field-label">Title</span>
              <input
                value={snipTitle}
                onChange={(e) => setSnipTitle(e.target.value.slice(0, REFINE_TITLE_MAX))}
                placeholder="e.g. Thicken ring"
                required
                maxLength={REFINE_TITLE_MAX}
              />
              <span className="template-field-meta">
                {snipTitle.length} / {REFINE_TITLE_MAX}
              </span>
            </label>
            <label className="template-field">
              <span className="template-field-label">Instruction</span>
              <textarea
                value={snipPrompt}
                onChange={(e) => setSnipPrompt(e.target.value.slice(0, REFINE_PROMPT_MAX))}
                rows={4}
                required
                maxLength={REFINE_PROMPT_MAX}
                placeholder="Refine instructions…"
              />
              <span className="template-field-meta">
                {snipPrompt.length} / {REFINE_PROMPT_MAX}
              </span>
            </label>
            <div className="row refine-files">
              <label>
                Photos (optional)
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
                  multiple
                  onChange={(e) => setSnipPhotos(e.target.files)}
                />
              </label>
              <label>
                Meshes (optional)
                <input
                  type="file"
                  accept=".stl,.ply,.xyz,.txt,.obj,.3mf"
                  multiple
                  onChange={(e) => setSnipMeshes(e.target.files)}
                />
              </label>
            </div>
            {snipEditId ? (
              <p className="hint">
                Leave file inputs empty to keep existing attachments when updating.
              </p>
            ) : null}
            {snipError ? <div className="banner bad">{snipError}</div> : null}
            <div className="settings-key-actions">
              <button type="submit" className="primary" disabled={snipBusy}>
                {snipBusy
                  ? 'Saving…'
                  : snipEditId
                    ? 'Update snippet'
                    : 'Save snippet'}
              </button>
              {snipEditId ? (
                <button
                  type="button"
                  onClick={() => {
                    setSnipEditId(null)
                    setSnipTitle('')
                    setSnipPrompt('')
                    setSnipPhotos(null)
                    setSnipMeshes(null)
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
