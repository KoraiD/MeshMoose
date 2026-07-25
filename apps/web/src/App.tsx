import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  applyFinish,
  cancelJob,
  createJob,
  createJobFromDemo,
  deleteJob,
  getApiToken,
  getJob,
  jobFileUrl,
  listArtifacts,
  listDemos,
  listFinishes,
  listJobs,
  patchJob,
  refineJob,
  retryJob,
  subscribeJobEvents,
  alignJob,
  demoAssetUrl,
  getReference,
  setReference,
  type AlignResult,
  type Artifact,
  type Demo,
  type ReferenceInfo,
  type FinishPreset,
  type Job,
  type JobEvent,
  type PromptEntry,
} from './api'
import { appLog } from './appLog'
import { AuthImage } from './AuthImage'
import { DocsPage } from './DocsPage'
import { flattenMetrics, highlightJson, highlightKcl } from './highlight'
import { collapseSame, diffLines } from './kclDiff'
import {
  listEngineSessions,
  registerEngineSession,
  subscribeEngineSessions,
  unregisterEngineSession,
} from './engineSessions'
import { MarkdownView } from './MarkdownView'
import {
  convertVolumeFromCm3,
  getVolumeUnit,
  setVolumeUnit,
  VOLUME_UNITS,
  volumeUnitLabel,
  type VolumeUnit,
} from './metricUnits'
import { ApiAccountModal } from './ApiAccountModal'
import {
  filterJobs,
  JOB_STATUS_OPTIONS,
  statusClass,
  type JobTimeFilter,
} from './jobFilters'
import {
  claimJobTerminalTransition,
  notifyJobTerminal,
} from './jobNotifications'
import { isJobRunning, jobActiveSeconds } from './jobTiming'
import { listPromptTemplates, type PromptTemplate } from './promptTemplates'
import {
  listRefineSnippets,
  loadCustomSnippetFiles,
  type RefineSnippet,
} from './refineSnippets'
import { JobsModal } from './JobsModal'
import { SettingsModal } from './SettingsModal'
import { StlViewport } from './StlViewport'
import {
  addTagToLibrary,
  filterTags,
  MAX_JOB_TAGS,
  MAX_TAG_LEN,
} from './tagLibrary'
import { applyTheme, getThemePreference } from './theme'
import { formatJobError } from './jobError'
import { UsageMeter } from './UsageMeter'
import {
  clearZooUsageCache,
  ensureZooUsageAutoRefresh,
  syncZooUsagePolling,
} from './zooUsageStore'
import './App.css'

const ZooEngineView = lazy(async () => {
  const mod = await import('./ZooEngineView')
  return { default: mod.ZooEngineView }
})

const MODES = ['thoughtful', 'fast', 'auto'] as const

/** Zoo publishes no hard prompt char limit; keep prompts focused (part, features, dims). */
const PROMPT_SOFT = 2000
const PROMPT_WARN = 4000
const PROMPT_MAX = 8000
/** Refine stays short so iterations stay focused. */
const REFINE_MAX = 2000

type DetailTab = 'compare' | 'engine' | 'workbench' | 'iterate'

const DETAIL_TABS = [
  ['compare', 'Compare'],
  ['engine', 'Live engine'],
  ['workbench', 'Workbench'],
  ['iterate', 'Iterate'],
] as const

function promptHistory(job: Job): PromptEntry[] {
  if (job.prompts?.length) return job.prompts
  if (!job.prompt) return []
  return [
    {
      role: 'initial',
      text: job.prompt,
      mode: job.mode,
      created_at: job.created_at,
    },
  ]
}

function formatPromptTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function parseMetrics(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function metricTip(label: string): string {
  const key = label.toLowerCase()
  if (key.startsWith('Δ volume') || key.includes('delta volume')) {
    return 'Generated volume minus reference volume (same units as the measure step).'
  }
  if (key.startsWith('Δ surface') || key.includes('delta surface')) {
    return 'Generated surface area minus reference surface area.'
  }
  if (key.startsWith('Δ mass') || key.includes('delta mass')) {
    return 'Generated mass minus reference mass (uses the assumed PLA-ish density).'
  }
  if (key.includes('ref → gen') && key.includes('volume')) {
    return 'Side-by-side solid volume: reference scan mesh → generated KCL mesh.'
  }
  if (key.includes('ref → gen') && key.includes('surface')) {
    return 'Side-by-side surface area: reference → generated.'
  }
  if (key.includes('ref → gen') && key.includes('mass')) {
    return 'Side-by-side estimated mass: reference → generated.'
  }
  if (key === 'volume' || key.endsWith('.volume')) {
    return 'Solid volume of the mesh from Zoo File Format API.'
  }
  if (key.includes('surface')) {
    return 'Outer surface area of the mesh from Zoo File Format API.'
  }
  if (key.includes('mass')) {
    return 'Estimated mass at the assumed material density (PLA-ish ~1240 kg/m³).'
  }
  if (key.includes('center-of-mass') || key.includes('center_of_mass')) {
    return 'Center of mass coordinates reported by Zoo File Format API.'
  }
  if (key === 'unavailable' || key.includes('unavailable')) {
    return 'Measure step could not produce a numeric comparison for this metric.'
  }
  if (key.includes('error') || key === '400' || key.endsWith('400')) {
    return 'The Zoo measure call failed for this field (often a bad mesh or API error). Re-run after the metrics fix or open Metrics JSON for details.'
  }
  return 'Metric derived from Zoo File Format measurements of reference vs generated meshes.'
}

function fmtMetricNumber(value: number, key: string, volumeUnit: VolumeUnit): string {
  const n =
    key === 'volume' || key.includes('volume')
      ? convertVolumeFromCm3(value, volumeUnit)
      : value
  return n.toPrecision(4)
}

function metricLines(
  data: Record<string, unknown>,
  volumeUnit: VolumeUnit = 'cm3',
): { label: string; value: string; tip: string }[] {
  const out: { label: string; value: string; tip: string }[] = []
  const volLabel = volumeUnitLabel(volumeUnit)
  const push = (label: string, value: string) => {
    out.push({ label, value, tip: metricTip(`${label} ${value}`) })
  }
  const delta = data.delta
  if (delta && typeof delta === 'object') {
    for (const [k, v] of Object.entries(delta as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const row = v as Record<string, unknown>
      if (typeof row.abs === 'number' && typeof row.reference === 'number') {
        const rel =
          typeof row.rel === 'number' ? ` (${(row.rel * 100).toPrecision(3)}%)` : ''
        const unitSuffix = k === 'volume' ? ` ${volLabel}` : ''
        push(
          `Δ ${k}${unitSuffix}`,
          `${fmtMetricNumber(row.abs, k, volumeUnit)}${rel}`,
        )
        push(
          `${k} ref → gen${unitSuffix}`,
          `${fmtMetricNumber(Number(row.reference), k, volumeUnit)} → ${fmtMetricNumber(Number(row.generated), k, volumeUnit)}`,
        )
      } else if (row.error) {
        push(k, String(row.error))
      }
    }
  }
  if (out.length) return out.slice(0, 8)

  const walk = (obj: unknown, prefix = '') => {
    if (!obj || typeof obj !== 'object') return
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === 'units' || k === 'delta') continue
      const key = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const rec = v as Record<string, unknown>
        if (typeof rec.error === 'string') {
          push(key, 'error')
          continue
        }
        if (typeof rec.status_code === 'number') {
          push(key, String(rec.status_code))
          continue
        }
        walk(v, key)
      } else if (typeof v === 'number') {
        push(key, Number.isInteger(v) ? String(v) : v.toPrecision(4))
      }
    }
  }
  walk(data)
  return out.slice(0, 8)
}

export default function App() {
  const [token, setToken] = useState(getApiToken())
  const [keySaved, setKeySaved] = useState(Boolean(getApiToken()))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiAccountOpen, setApiAccountOpen] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [refineSnippets, setRefineSnippets] = useState<RefineSnippet[]>([])
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const prevJobStatusRef = useRef<Map<string, string>>(new Map())
  const [demos, setDemos] = useState<Demo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const id = new URLSearchParams(window.location.search).get('job')
    return id?.trim() || null
  })
  const [job, setJob] = useState<Job | null>(null)
  const [jobLoading, setJobLoading] = useState(false)
  const [events, setEvents] = useState<JobEvent[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [createPane, setCreatePane] = useState<'upload' | 'demo'>('upload')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [jobsDrawerOpen, setJobsDrawerOpen] = useState(false)
  const [compareAlignOpen, setCompareAlignOpen] = useState(false)
  const [compareNudgeOpen, setCompareNudgeOpen] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<string>('thoughtful')
  const [photos, setPhotos] = useState<FileList | null>(null)
  const [meshes, setMeshes] = useState<FileList | null>(null)
  const [localMeshUrl, setLocalMeshUrl] = useState<string | null>(null)
  const [refine, setRefine] = useState('')
  const [refinePhotos, setRefinePhotos] = useState<FileList | null>(null)
  const [refineMeshes, setRefineMeshes] = useState<FileList | null>(null)
  const [refinePkgPhotos, setRefinePkgPhotos] = useState<File[]>([])
  const [refinePkgMeshes, setRefinePkgMeshes] = useState<File[]>([])
  const [refineSnippetId, setRefineSnippetId] = useState('')
  const [finishes, setFinishes] = useState<FinishPreset[]>([])
  const [finishId, setFinishId] = useState('brushed-aluminum')
  const [error, setError] = useState<string | null>(null)
  const [kcl, setKcl] = useState('')
  const [initialKcl, setInitialKcl] = useState('')
  const [kclView, setKclView] = useState<'current' | 'diff'>('current')
  const [metrics, setMetrics] = useState<string>('')
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [hasReference, setHasReference] = useState(false)
  const [hasGenerated, setHasGenerated] = useState(false)
  const [logFilter, setLogFilter] = useState<
    'all' | 'debug' | 'info' | 'warn' | 'error'
  >('all')
  const [detailTab, setDetailTab] = useState<DetailTab>('compare')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [engineOn, setEngineOn] = useState(false)
  const [metricsView, setMetricsView] = useState<'json' | 'table'>('json')
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [appView, setAppView] = useState<'app' | 'docs'>('app')
  const [compareMode, setCompareMode] = useState<'side' | 'overlay'>('overlay')
  const [refOpacity, setRefOpacity] = useState(0.45)
  const [genOpacity, setGenOpacity] = useState(1)
  const [alignResult, setAlignResult] = useState<AlignResult | null>(null)
  const [alignBusy, setAlignBusy] = useState(false)
  const [alignError, setAlignError] = useState<string | null>(null)
  const [heatmapOn, setHeatmapOn] = useState(false)
  const [nudge, setNudge] = useState<{
    translate: [number, number, number]
    rotateDeg: [number, number, number]
    scale: number
  }>({ translate: [0, 0, 0], rotateDeg: [0, 0, 0], scale: 1 })
  const [referenceInfo, setReferenceInfo] = useState<ReferenceInfo | null>(null)
  const [referenceTick, setReferenceTick] = useState(0)
  const [volumeUnit, setVolumeUnitState] = useState<VolumeUnit>(() => getVolumeUnit())
  const [jobTitleDraft, setJobTitleDraft] = useState('')
  const [createTitle, setCreateTitle] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [templates, setTemplates] = useState<PromptTemplate[]>(() => listPromptTemplates())
  const [jobQuery, setJobQuery] = useState('')
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('all')
  const [jobTimeFilter, setJobTimeFilter] = useState<JobTimeFilter>('all')
  const logPanelRef = useRef<HTMLDivElement>(null)
  const stickLogToBottom = useRef(true)
  const jobsListRef = useRef<HTMLUListElement>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [jobsHasMore, setJobsHasMore] = useState(false)
  const [jobsModalOpen, setJobsModalOpen] = useState(false)
  const [engineSessions, setEngineSessions] = useState(listEngineSessions())

  useEffect(() => subscribeEngineSessions(() => setEngineSessions(listEngineSessions())), [])

  // Keep the engine-session registry in sync with the Live Engine tab.
  useEffect(() => {
    if (engineOn && job) {
      registerEngineSession(job.id, job.title || job.id)
      return () => unregisterEngineSession(job.id)
    }
  }, [engineOn, job?.id, job?.title])

  // Zoo usage: keep 10-min auto-refresh alive while the app is open (not only while the API modal is open).
  useEffect(() => {
    ensureZooUsageAutoRefresh()
  }, [keySaved])

  useEffect(() => {
    applyTheme(getThemePreference())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (getThemePreference() === 'system') applyTheme('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (selectedId) url.searchParams.set('job', selectedId)
    else url.searchParams.delete('job')
    const next = `${url.pathname}${url.search}${url.hash}`
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (next !== current) {
      window.history.replaceState(null, '', next)
    }
  }, [selectedId])

  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get('job')
      setSelectedId(id?.trim() || null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const reportError = useCallback((message: string) => {
    setError(message)
    appLog(message, 'error')
  }, [])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null
      setToast(null)
    }, 6000)
  }, [])

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    },
    [],
  )

  const refreshJobs = useCallback(async () => {
    if (!getApiToken()) {
      setJobs([])
      return
    }
    try {
      setJobs(await listJobs())
    } catch (e) {
      showToast((e as Error).message)
    }
  }, [showToast])

  const refreshArtifacts = useCallback(async (jobId: string) => {
    try {
      const items = await listArtifacts(jobId)
      setArtifacts(items)
      setHasReference(items.some((a) => a.kind === 'reference_mesh'))
      setHasGenerated(items.some((a) => a.kind === 'generated_mesh'))
    } catch {
      /* ignore while job is young */
    }
  }, [])

  const announceJobTerminal = useCallback(
    (j: { id: string; title?: string; status: string }, previousStatus?: string) => {
      if (!claimJobTerminalTransition(j.id, previousStatus, j.status, isJobRunning)) {
        return
      }
      const label = j.title?.trim() || j.id.slice(-12)
      appLog(
        j.status === 'succeeded'
          ? `Job “${label}” finished successfully.`
          : `Job “${label}” failed.`,
        j.status === 'failed' ? 'error' : 'info',
      )
      notifyJobTerminal(j)
    },
    [],
  )

  useEffect(() => {
    void listDemos().then(setDemos).catch(() => setDemos([]))
  }, [])

  useEffect(() => {
    if (!token) {
      setFinishes([])
      return
    }
    void listFinishes()
      .then((items) => {
        setFinishes(items)
        setFinishId((prev) =>
          items.some((f) => f.id === prev) ? prev : items[0]?.id || prev,
        )
      })
      .catch(() => setFinishes([]))
  }, [token])

  useEffect(() => {
    void refreshJobs()
  }, [refreshJobs, token])

  // Keep the jobs list fresh even if the SSE stream drops (API reload, idle proxy).
  useEffect(() => {
    if (!getApiToken()) return
    const anyRunning = jobs.some((j) => isJobRunning(j.status))
    if (!anyRunning) return
    const id = window.setInterval(() => {
      void refreshJobs()
    }, 2500)
    return () => window.clearInterval(id)
  }, [jobs, refreshJobs])

  // Mirror list status onto the open job so Compare/Workbench update without a full reload.
  useEffect(() => {
    if (!selectedId) return
    const listed = jobs.find((j) => j.id === selectedId)
    if (!listed) return
    setJob((prev) => {
      if (!prev || prev.id !== listed.id) return prev
      if (
        prev.status === listed.status &&
        prev.updated_at === listed.updated_at &&
        prev.error === listed.error
      ) {
        return prev
      }
      return { ...prev, ...listed }
    })
  }, [jobs, selectedId])

  useEffect(() => {
    if (!meshes?.length) {
      setLocalMeshUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      return
    }
    // Local Three.js preview is STL-only; other formats convert server-side.
    const file =
      Array.from(meshes).find((f) => f.name.toLowerCase().endsWith('.stl')) || null
    if (!file) {
      setLocalMeshUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      return
    }
    const url = URL.createObjectURL(file)
    setLocalMeshUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
    return () => URL.revokeObjectURL(url)
  }, [meshes])

  useEffect(() => {
    if (!selectedId || !getApiToken()) {
      setJob(null)
      setJobLoading(false)
      setEvents([])
      setKcl('')
      setMetrics('')
      setArtifacts([])
      setHasReference(false)
      setHasGenerated(false)
      return
    }
    let active = true
    setJob(null)
    setJobLoading(true)
    void getJob(selectedId)
      .then((j) => {
        if (!active) return
        setJob(j)
        setJobLoading(false)
      })
      .catch((e) => {
        if (!active) return
        setJobLoading(false)
        showToast((e as Error).message)
      })
    void refreshArtifacts(selectedId)

    setEvents([])
    // Backlog replay can be hundreds of events; batch UI updates and debounce
    // job/artifact refreshes so Compare viewports don't remount/flash.
    // Browser alerts come from the jobs-list watcher + poller (SSE alone can die
    // on API reload without the UI noticing).
    let eventBuf: JobEvent[] = []
    let rafId: number | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const flushEvents = () => {
      rafId = null
      if (!active || !eventBuf.length) return
      const batch = eventBuf
      eventBuf = []
      setEvents((prev) => [...prev, ...batch])
      let needRefresh = false
      for (const ev of batch) {
        if (ev.path?.includes('reference.stl')) setHasReference(true)
        if (ev.path?.includes('generated.stl')) setHasGenerated(true)
        if (
          ev.kind === 'status' ||
          ev.kind === 'stream_end' ||
          ev.kind === 'refine' ||
          ev.kind === 'finish' ||
          ev.kind === 'export' ||
          ev.kind === 'artifact'
        ) {
          needRefresh = true
        }
        if (ev.kind === 'status' && ev.status) {
          appLog(`Job ${selectedId.slice(-8)} → ${ev.status}`)
          if (ev.status === 'succeeded') {
            appLog(`Job ${selectedId.slice(-8)} ready — outputs updated`)
          }
        }
        if (ev.kind === 'finish' && ev.message) {
          appLog(ev.message)
        }
      }
      if (needRefresh) {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          refreshTimer = null
          if (!active) return
          void getJob(selectedId).then(setJob).catch(() => undefined)
          void refreshJobs()
          void refreshArtifacts(selectedId)
        }, 280)
      }
    }

    const stop = subscribeJobEvents(
      selectedId,
      (ev) => {
        eventBuf.push(ev)
        if (rafId == null) {
          rafId = window.requestAnimationFrame(flushEvents)
        }
      },
      (err) => reportError(err.message),
    )
    return () => {
      active = false
      if (rafId != null) cancelAnimationFrame(rafId)
      if (refreshTimer) clearTimeout(refreshTimer)
      stop()
    }
  }, [selectedId, refreshJobs, refreshArtifacts, reportError, showToast])

  useEffect(() => {
    if (!job) return
    if (job.status !== 'succeeded' && job.status !== 'failed') return
    const headers = { Authorization: `Bearer ${getApiToken()}` }
    // Bust caches so Apply finish / refine always reloads rewritten main.kcl.
    const bust = `t=${encodeURIComponent(job.updated_at || String(Date.now()))}`
    void fetch(`${jobFileUrl(job.id, 'outputs/main.kcl')}?${bust}`, { headers })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        setKcl(text)
      })
    void fetch(`${jobFileUrl(job.id, 'outputs/metrics.json')}?${bust}`, { headers })
      .then((r) => (r.ok ? r.text() : ''))
      .then(setMetrics)
    void fetch(`${jobFileUrl(job.id, 'outputs/main.initial.kcl')}?${bust}`, { headers })
      .then((r) => (r.ok ? r.text() : ''))
      .then(setInitialKcl)
    void getReference(job.id).then(setReferenceInfo).catch(() => setReferenceInfo(null))
  }, [job?.id, job?.status, job?.updated_at, referenceTick])

  useEffect(() => {
    stickLogToBottom.current = true
    setKcl('')
    setInitialKcl('')
    setMetrics('')
    setAlignResult(null)
    setAlignError(null)
    setHeatmapOn(false)
    setNudge({ translate: [0, 0, 0], rotateDeg: [0, 0, 0], scale: 1 })
    setReferenceInfo(null)
  }, [selectedId])

  useEffect(() => {
    if (!createOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCreateOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createOpen])

  const filteredLogs = useMemo(() => {
    return events.filter((e) => {
      if (e.kind === 'assistant_delta') return false
      if (logFilter === 'all') return true
      return (e.level || 'info') === logFilter
    })
  }, [events, logFilter])

  useEffect(() => {
    const el = logPanelRef.current
    if (!el || detailTab !== 'workbench') return
    if (!stickLogToBottom.current) return
    el.scrollTop = el.scrollHeight
  }, [filteredLogs, detailTab])

  const snapshots = useMemo(() => {
    const refs = artifacts.filter((a) => a.kind === 'reference_photo')
    const agent = artifacts.filter((a) => a.kind === 'agent_snapshot')
    return [...refs, ...agent]
  }, [artifacts])
  const referenceArt = useMemo(
    () => artifacts.find((a) => a.kind === 'reference_mesh'),
    [artifacts],
  )
  const generatedArt = useMemo(
    () => artifacts.find((a) => a.kind === 'generated_mesh'),
    [artifacts],
  )
  const hasKcl = useMemo(
    () => artifacts.some((a) => a.name === 'main.kcl') || Boolean(kcl),
    [artifacts, kcl],
  )
  const metricsObj = useMemo(() => parseMetrics(metrics), [metrics])
  const metricChips = useMemo(
    () => (metricsObj ? metricLines(metricsObj, volumeUnit) : []),
    [metricsObj, volumeUnit],
  )

  useEffect(() => {
    if (job) setJobTitleDraft(job.title)
    else setJobTitleDraft('')
    setTagDraft('')
  }, [job?.id, job?.title])

  const filteredJobs = useMemo(
    () =>
      filterJobs(jobs, {
        query: jobQuery,
        status: jobStatusFilter,
        time: jobTimeFilter,
      }),
    [jobs, jobQuery, jobStatusFilter, jobTimeFilter],
  )

  // Track whether the jobs list has content below the fold for the scroll fade.
  const updateJobsHasMore = useCallback(() => {
    const el = jobsListRef.current
    if (!el) {
      setJobsHasMore(false)
      return
    }
    setJobsHasMore(el.scrollHeight - el.clientHeight - el.scrollTop > 4)
  }, [])
  const onJobsScroll = useCallback(() => updateJobsHasMore(), [updateJobsHasMore])
  useEffect(() => {
    updateJobsHasMore()
    const el = jobsListRef.current
    if (!el) return
    const ro = new ResizeObserver(updateJobsHasMore)
    ro.observe(el)
    return () => ro.disconnect()
  }, [filteredJobs.length, updateJobsHasMore])

  const metricsTable = useMemo(
    () => (metricsObj ? flattenMetrics(metricsObj) : []),
    [metricsObj],
  )
  const kclHtml = useMemo(() => highlightKcl(kcl), [kcl])
  const metricsHtml = useMemo(() => highlightJson(metrics), [metrics])
  const kclDiffLines = useMemo(
    () => collapseSame(diffLines(initialKcl, kcl)),
    [initialKcl, kcl],
  )

  const jobSeconds = useMemo(
    () => jobActiveSeconds(job, nowTick),
    [job, nowTick],
  )

  useEffect(() => {
    if (!job || !isJobRunning(job.status)) return
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [job])

  useEffect(() => {
    void listRefineSnippets().then(setRefineSnippets).catch(() => setRefineSnippets([]))
  }, [])

  useEffect(() => {
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (id) setSelectedId(id)
    }
    window.addEventListener('meshmoose:select-job', onSelect)
    return () => window.removeEventListener('meshmoose:select-job', onSelect)
  }, [])

  useEffect(() => {
    const prev = prevJobStatusRef.current
    for (const j of jobs) {
      const before = prev.get(j.id)
      announceJobTerminal(j, before)
      prev.set(j.id, j.status)
    }
  }, [jobs, announceJobTerminal])

  const promptLen = prompt.length
  const promptHint =
    promptLen > PROMPT_WARN
      ? `Long prompt (${promptLen}/${PROMPT_MAX}). Zoo has no published hard limit, but shorter focused prompts usually work better.`
      : promptLen > PROMPT_SOFT
        ? `${promptLen} chars — include part type, key features, and dimensions; avoid essays.`
        : `${promptLen}/${PROMPT_SOFT} recommended · max ${PROMPT_MAX}`

  const refineLen = refine.length
  const refineHint = `${refineLen}/${REFINE_MAX}`
  const jobRunning = Boolean(job && isJobRunning(job.status))
  const canRefine = Boolean(job && !jobRunning && hasKcl)
  const history = job ? promptHistory(job) : []

  function onTokenChange(next: string) {
    setToken(next)
    setKeySaved(Boolean(next))
    setError(null)
    if (next) {
      appLog('Zoo API token saved in localStorage')
      syncZooUsagePolling()
    } else {
      appLog('Zoo API token cleared', 'warn')
      clearZooUsageCache()
    }
    void refreshJobs()
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCreateError(null)
    if (!getApiToken()) {
      const msg = 'Save a Zoo API token first (API key button).'
      setCreateError(msg)
      reportError(msg)
      setApiAccountOpen(true)
      return
    }
    if (!photos?.length || !meshes?.length) {
      setCreateError('Add at least one photo and one mesh (STL / PLY / OBJ / 3MF / XYZ).')
      return
    }
    if (!prompt.trim()) {
      setCreateError('Enter a prompt (or pick a template).')
      return
    }
    if (prompt.length > PROMPT_MAX) {
      setCreateError(`Prompt exceeds ${PROMPT_MAX} characters.`)
      return
    }
    const form = new FormData()
    form.set('prompt', prompt)
    form.set('mode', mode)
    if (createTitle.trim()) form.set('title', createTitle.trim())
    Array.from(photos).forEach((f) => form.append('photos', f))
    Array.from(meshes).forEach((f) => form.append('meshes', f))
    setCreating(true)
    try {
      const created = await createJob(form)
      setSelectedId(created.id)
      setCreateOpen(false)
      setCreateTitle('')
      setCreateError(null)
      appLog(`Created job ${created.id} (${mode})`)
      await refreshJobs()
    } catch (err) {
      const msg = (err as Error).message || 'Could not create job'
      setCreateError(msg)
      reportError(msg)
    } finally {
      setCreating(false)
    }
  }

  async function onSaveJobTitle() {
    if (!job) return
    const next = jobTitleDraft.trim()
    if (!next || next === job.title) return
    try {
      const updated = await patchJob(job.id, { title: next })
      setJob(updated)
      appLog(`Renamed job to “${updated.title}”`)
      await refreshJobs()
    } catch (err) {
      reportError((err as Error).message)
    }
  }

  async function onAddTag() {
    if (!job) return
    let tag = tagDraft.trim()
    if (!tag) return
    const current = job.tags || []
    if (current.length >= MAX_JOB_TAGS) {
      reportError(`At most ${MAX_JOB_TAGS} tags per job.`)
      return
    }
    if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setTagDraft('')
      setTagSuggestions([])
      return
    }
    try {
      tag = addTagToLibrary(tag)
      const updated = await patchJob(job.id, { tags: [...current, tag] })
      setJob(updated)
      setTagDraft('')
      setTagSuggestions([])
      appLog(`Tagged job with “${tag}”`)
      await refreshJobs()
    } catch (err) {
      reportError((err as Error).message)
    }
  }

  async function onRemoveTag(tag: string) {
    if (!job) return
    try {
      const updated = await patchJob(job.id, {
        tags: (job.tags || []).filter((t) => t !== tag),
      })
      setJob(updated)
      await refreshJobs()
    } catch (err) {
      reportError((err as Error).message)
    }
  }

  function applyTemplate(t: PromptTemplate) {
    setPrompt(t.prompt.slice(0, PROMPT_MAX))
    setCreateTitle(t.title)
    appLog(`Applied prompt template “${t.title}”`)
  }


  async function onDemo(demo: Demo) {
    setError(null)
    setCreateError(null)
    if (!getApiToken()) {
      const msg = 'Save a Zoo API token first (API key button).'
      setCreateError(msg)
      reportError(msg)
      setApiAccountOpen(true)
      return
    }
    setPrompt(demo.prompt)
    setMode(demo.mode || 'thoughtful')
    setCreating(true)
    try {
      const created = await createJobFromDemo(demo.id, demo.mode || mode, demo.prompt)
      setSelectedId(created.id)
      setCreateOpen(false)
      setCreateError(null)
      appLog(`Started demo “${demo.title}” as job ${created.id}`)
      await refreshJobs()
    } catch (err) {
      const msg = (err as Error).message || 'Could not start demo'
      setCreateError(msg)
      reportError(msg)
    } finally {
      setCreating(false)
    }
  }

  async function applyRefineSnippet(id: string) {
    setRefineSnippetId(id)
    const snippet = refineSnippets.find((s) => s.id === id)
    if (!snippet) {
      setRefinePkgPhotos([])
      setRefinePkgMeshes([])
      return
    }
    setRefine(snippet.prompt.slice(0, REFINE_MAX))
    if (snippet.attach) {
      try {
        const fetchFile = async (name: string): Promise<File> => {
          const res = await fetch(demoAssetUrl(snippet.attach!.demoId, name))
          if (!res.ok) throw new Error(`demo asset ${name} ${res.status}`)
          const blob = await res.blob()
          return new File([blob], name, {
            type: blob.type || 'application/octet-stream',
          })
        }
        const photos = await Promise.all((snippet.attach.photos ?? []).map(fetchFile))
        const meshes = await Promise.all((snippet.attach.meshes ?? []).map(fetchFile))
        setRefinePkgPhotos(photos)
        setRefinePkgMeshes(meshes)
      } catch (err) {
        reportError(`Could not load refine package assets: ${(err as Error).message}`)
        setRefinePkgPhotos([])
        setRefinePkgMeshes([])
      }
      return
    }
    if (!snippet.builtin) {
      try {
        const files = await loadCustomSnippetFiles(snippet.id)
        setRefinePkgPhotos(files.photos)
        setRefinePkgMeshes(files.meshes)
      } catch (err) {
        reportError(`Could not load snippet attachments: ${(err as Error).message}`)
        setRefinePkgPhotos([])
        setRefinePkgMeshes([])
      }
      return
    }
    setRefinePkgPhotos([])
    setRefinePkgMeshes([])
  }

  async function onRefine(e: FormEvent) {
    e.preventDefault()
    if (!job || !refine.trim() || !canRefine) return
    if (refine.length > REFINE_MAX) {
      reportError(`Refine message exceeds ${REFINE_MAX} characters.`)
      return
    }
    setError(null)
    try {
      const photos = [...(refinePhotos ? Array.from(refinePhotos) : []), ...refinePkgPhotos]
      const meshes = [...(refineMeshes ? Array.from(refineMeshes) : []), ...refinePkgMeshes]
      const updated = await refineJob(job.id, refine.trim(), {
        photos: photos.length ? photos : null,
        meshes: meshes.length ? meshes : null,
      })
      setJob(updated)
      setRefine('')
      setRefinePhotos(null)
      setRefineMeshes(null)
      setRefinePkgPhotos([])
      setRefinePkgMeshes([])
      setRefineSnippetId('')
      setKcl('')
      setMetrics('')
      setDetailTab('iterate')
      appLog(
        `Refine queued on ${job.id.slice(-8)}` +
          (photos.length || meshes.length ? ' with attachments' : ''),
      )
      await refreshJobs()
    } catch (err) {
      reportError((err as Error).message)
    }
  }

  async function onApplyFinish(e: FormEvent) {
    e.preventDefault()
    if (!job || !canRefine || !finishId) return
    setError(null)
    const jobId = job.id
    const name = finishes.find((f) => f.id === finishId)?.name || finishId
    try {
      const updated = await applyFinish(jobId, finishId)
      setJob(updated)
      setDetailTab('engine')
      setEngineOn(true)
      appLog(`Apply finish queued: ${name}`)
      await refreshJobs()
      // Poll until export finishes even if the event stream was briefly idle.
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => window.setTimeout(r, 1000))
        const j = await getJob(jobId)
        setJob(j)
        if (j.status === 'succeeded' || j.status === 'failed') {
          if (j.status === 'succeeded') {
            appLog(`Finish ready: ${name}`)
            setEngineOn(true)
          } else {
            reportError(j.error || 'Apply finish failed')
          }
          await refreshJobs()
          break
        }
      }
    } catch (err) {
      reportError((err as Error).message)
    }
  }

  const selectedFinish = useMemo(
    () => finishes.find((f) => f.id === finishId) || null,
    [finishes, finishId],
  )

  function onDeleteJob(jobId: string) {
    setDeleteConfirmId(jobId)
  }

  async function confirmDeleteJob() {
    const jobId = deleteConfirmId
    if (!jobId) return
    setDeleteConfirmId(null)
    setError(null)
    try {
      await deleteJob(jobId)
      if (selectedId === jobId) setSelectedId(null)
      appLog(`Deleted job ${jobId}`, 'warn')
      await refreshJobs()
    } catch (err) {
      reportError((err as Error).message)
    }
  }

  async function onRetryJob(jobId: string) {
    setError(null)
    try {
      const created = await retryJob(jobId)
      setSelectedId(created.id)
      setDetailTab('workbench')
      appLog(`Retry started as ${created.id} (from ${jobId.slice(-8)})`)
      await refreshJobs()
    } catch (err) {
      reportError((err as Error).message)
    }
  }

  async function onCancelJob() {
    if (!job) return
    setError(null)
    try {
      const updated = await cancelJob(job.id)
      setJob(updated)
      appLog(`Cancelled job ${job.id.slice(-8)}`, 'warn')
      await refreshJobs()
    } catch (err) {
      reportError((err as Error).message)
    }
  }

  async function onCancelJobById(jobId: string) {
    setError(null)
    try {
      const updated = await cancelJob(jobId)
      if (job?.id === jobId) setJob(updated)
      appLog(`Cancelled job ${jobId.slice(-8)}`, 'warn')
      await refreshJobs()
    } catch (err) {
      reportError((err as Error).message)
    }
  }

  function onStopEngine(jobId: string) {
    if (job?.id === jobId) {
      setEngineOn(false)
      setDetailTab((t) => (t === 'engine' ? 'compare' : t))
    }
    unregisterEngineSession(jobId)
    appLog(`Stopped live engine session for ${jobId.slice(-8)}`, 'warn')
  }

  async function downloadAuth(jobId: string, relative: string, filename: string) {
    try {
      const res = await fetch(jobFileUrl(jobId, relative), {
        headers: { Authorization: `Bearer ${getApiToken()}` },
      })
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      appLog(`Downloaded ${filename}`)
    } catch (err) {
      reportError((err as Error).message)
    }
  }

  const generatedDownloads = job
    ? [
        {
          label: 'STL',
          onClick: () =>
            void downloadAuth(job.id, 'outputs/generated.stl', 'generated.stl'),
        },
        {
          label: 'STEP',
          onClick: () =>
            void downloadAuth(job.id, 'outputs/generated.step', 'generated.step'),
        },
        {
          label: '3MF',
          onClick: () =>
            void downloadAuth(job.id, 'outputs/generated.3mf', 'generated.3mf'),
        },
      ]
    : []

  const assistantText = events
    .filter((e) => e.kind === 'assistant_delta' && e.message)
    .map((e) => e.message)
    .join('')

  const showJobReference = Boolean(job && hasReference)
  const showLocalReference = Boolean(localMeshUrl)
  const refineAttachHint = [
    (refinePhotos?.length ?? 0) + refinePkgPhotos.length
      ? `${(refinePhotos?.length ?? 0) + refinePkgPhotos.length} photo(s)`
      : null,
    (refineMeshes?.length ?? 0) + refinePkgMeshes.length
      ? `${(refineMeshes?.length ?? 0) + refinePkgMeshes.length} mesh(es)`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  if (appView === 'docs') {
    return (
      <div className="app">
        <header className="topbar topbar-slim">
          <div className="brand-row">
            <img
              className="brand-logo"
              src="/logo.png"
              width={56}
              height={56}
              alt="MeshMoose"
            />
            <div className="brand-text">
              <p className="eyebrow">Multimodal reconstruction</p>
              <h1 className="brand">
                Mesh<span>Moose</span>
              </h1>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className={`api-key-btn ${keySaved ? 'on' : 'off'}`}
              onClick={() => setApiAccountOpen(true)}
              title="Zoo API token and usage"
            >
              <span className="api-key-dot" aria-hidden />
              {keySaved ? 'API key on' : 'API key needed'}
            </button>
            <button type="button" onClick={() => setAppView('app')}>
              ← Back to app
            </button>
          </div>
        </header>
        <DocsPage embedded onBack={() => setAppView('app')} />
        <ApiAccountModal
          open={apiAccountOpen}
          onClose={() => setApiAccountOpen(false)}
          onTokenChange={onTokenChange}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-mark">
          <div className="brand-row">
            <img
              className="brand-logo"
              src="/logo.png"
              width={56}
              height={56}
              alt="MeshMoose"
            />
            <div className="brand-text">
              <p className="eyebrow">Multimodal reconstruction</p>
              <h1 className="brand">
                Mesh<span>Moose</span>
              </h1>
            </div>
          </div>
          <p className="tag tag-desktop">
            From rough scans to editable CAD — photo, mesh, and text into
            parametric KCL.
          </p>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="jobs-mobile-toggle"
            onClick={() => setJobsDrawerOpen(true)}
          >
            Jobs
          </button>
          <button
            type="button"
            className={`api-key-btn ${keySaved ? 'on' : 'off'}`}
            onClick={() => setApiAccountOpen(true)}
            title="Zoo API token and usage"
          >
            <span className="api-key-dot" aria-hidden />
            {keySaved ? 'API key on' : 'API key needed'}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setCreateError(null)
              setCreatePane('upload')
              setCreateOpen(true)
            }}
          >
            New job
          </button>
          <button type="button" onClick={() => setAppView('docs')}>
            Docs
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>

      {toast ? (
        <div className="banner warn toast-banner" role="status">
          {toast}{' '}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
              toastTimerRef.current = null
              setToast(null)
            }}
          >
            dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="banner bad">
          {error}{' '}
          <button type="button" className="linkish" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      ) : null}

      {!keySaved ? (
        <div className="banner warn">
          Add your Zoo API token to create jobs and stream Engine previews.
          <button type="button" className="linkish" onClick={() => setApiAccountOpen(true)}>
            Open API key
          </button>
        </div>
      ) : null}

      {jobsDrawerOpen ? (
        <div
          className="jobs-drawer-backdrop"
          onClick={() => setJobsDrawerOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="layout">
        <aside className={`panel jobs${jobsDrawerOpen ? ' drawer-open' : ''}`}>
          <div className="jobs-head">
            <h2>Jobs</h2>
            <div className="jobs-head-actions">
              <button
                type="button"
                className="jobs-drawer-close"
                onClick={() => setJobsDrawerOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setJobsDrawerOpen(false)
                  setJobsModalOpen(true)
                }}
                title="Open the full jobs list, in-progress runs, and engine sessions"
              >
                All jobs
              </button>
            </div>
          </div>
          <div className="jobs-filters">
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
            {(jobQuery || jobStatusFilter !== 'all' || jobTimeFilter !== 'all') && (
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
            )}
          </div>
          <div className={`jobs-list-wrap${jobsHasMore ? ' has-more' : ''}`}>
            <ul ref={jobsListRef} onScroll={onJobsScroll}>
              {filteredJobs.map((j) => (
                <li key={j.id} className="job-row">
                <button
                  type="button"
                  className={`job-select${j.id === selectedId ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedId(j.id)
                    setJobsDrawerOpen(false)
                  }}
                >
                  <span className={`pill ${statusClass(j.status)}`}>{j.status}</span>
                  <span className="job-title">{j.title}</span>
                  {j.tags?.length ? (
                    <span className="job-tags-inline">
                      {j.tags.map((t) => (
                        <span key={t} className="tag-chip tiny">
                          {t}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="muted">{new Date(j.created_at).toLocaleString()}</span>
                </button>
                </li>
              ))}
              {!jobs.length ? (
                <li className="muted empty">No jobs yet</li>
              ) : !filteredJobs.length ? (
                <li className="muted empty">No jobs match this filter</li>
              ) : null}
            </ul>
            {filteredJobs.length > 0 ? (
              <div className="jobs-end" aria-hidden="true">
                {jobsHasMore ? `${filteredJobs.length} jobs · scroll for more` : `${filteredJobs.length} jobs · end of list`}
              </div>
            ) : null}
          </div>
        </aside>

        <main className="main-col">
          {selectedId && !job && jobLoading ? (
            <section className="panel detail empty-detail" aria-busy="true">
              <p className="muted">Loading job…</p>
            </section>
          ) : selectedId && !job ? (
            <section className="panel detail empty-detail">
              <p className="eyebrow">Couldn&apos;t load job</p>
              <h2>Something went wrong</h2>
              <p className="muted">
                This job couldn&apos;t be loaded. Check the toast for details, pick another
                job, or try again.
              </p>
            </section>
          ) : job ? (
            <section className="panel detail">
              <div className="detail-head">
                <div className="detail-title-edit">
                  <input
                    className="job-title-input"
                    value={jobTitleDraft}
                    onChange={(e) => setJobTitleDraft(e.target.value.slice(0, 80))}
                    onBlur={() => void onSaveJobTitle()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void onSaveJobTitle()
                      }
                    }}
                    aria-label="Job title"
                  />
                  <span className={`pill ${statusClass(job.status)}`}>{job.status}</span>
                </div>
                <div className="detail-actions">
                  {jobRunning ? (
                    <button type="button" onClick={() => void onCancelJob()}>
                      Cancel run
                    </button>
                  ) : null}
                  {job.status === 'failed' ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void onRetryJob(job.id)}
                    >
                      Retry job
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="job-delete"
                    onClick={() => void onDeleteJob(job.id)}
                  >
                    Delete job
                  </button>
                </div>
              </div>
              <div className="job-tags-row">
                {(job.tags || []).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="tag-chip"
                    title="Remove tag"
                    onClick={() => void onRemoveTag(t)}
                  >
                    {t} ×
                  </button>
                ))}
                {(job.tags || []).length < MAX_JOB_TAGS ? (
                  <form
                    className="tag-add-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void onAddTag()
                    }}
                  >
                    <div className="tag-suggest-wrap">
                      <input
                        value={tagDraft}
                        onChange={(e) => {
                          const next = e.target.value.slice(0, MAX_TAG_LEN)
                          setTagDraft(next)
                          setTagSuggestions(filterTags(next, job.tags || []))
                        }}
                        onFocus={() =>
                          setTagSuggestions(filterTags(tagDraft, job.tags || []))
                        }
                        onBlur={() => {
                          window.setTimeout(() => setTagSuggestions([]), 120)
                        }}
                        placeholder="Add tag"
                        aria-label="Add tag"
                        maxLength={MAX_TAG_LEN}
                        autoComplete="off"
                      />
                      {tagSuggestions.length ? (
                        <ul className="tag-suggest-list" role="listbox">
                          {tagSuggestions.map((t) => (
                            <li key={t}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setTagDraft(t)
                                  setTagSuggestions([])
                                }}
                              >
                                {t}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <button type="submit" className="linkish" disabled={!tagDraft.trim()}>
                      Add
                    </button>
                  </form>
                ) : null}
              </div>
              <p className="job-id-line muted">
                Job ID <code>{job.id}</code>
                {job.retry_of ? (
                  <>
                    {' '}
                    · retry of{' '}
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => setSelectedId(job.retry_of || null)}
                    >
                      {job.retry_of}
                    </button>
                  </>
                ) : null}
              </p>
              {job.error ? (
                <div className="banner bad job-error">{formatJobError(job.error)}</div>
              ) : null}
              {job.notes ? <div className="banner warn">{job.notes}</div> : null}

              <div
                className="detail-tabs"
                role="tablist"
                aria-label="Job views"
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                  e.preventDefault()
                  const ids = DETAIL_TABS.map(([id]) => id)
                  const idx = ids.indexOf(detailTab)
                  const next =
                    e.key === 'ArrowRight'
                      ? ids[(idx + 1) % ids.length]
                      : ids[(idx - 1 + ids.length) % ids.length]
                  setDetailTab(next)
                  if (next === 'engine') setEngineOn(true)
                  else setEngineOn(false)
                }}
              >
                {DETAIL_TABS.map(([id, label]) => (
                  <button
                    key={id}
                    id={`tab-${id}`}
                    type="button"
                    role="tab"
                    aria-selected={detailTab === id}
                    aria-controls={`panel-${id}`}
                    className={detailTab === id ? 'active' : ''}
                    onClick={() => {
                      setDetailTab(id)
                      if (id === 'engine') setEngineOn(true)
                      else setEngineOn(false)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {detailTab === 'compare' ? (
                <div
                  className="compare-wrap"
                  role="tabpanel"
                  id="panel-compare"
                  aria-labelledby="tab-compare"
                >
                  <div className="compare-toolbar">
                    <div className="view-toggle" role="group" aria-label="Compare mode">
                      <button
                        type="button"
                        className={compareMode === 'side' ? 'active' : ''}
                        onClick={() => setCompareMode('side')}
                      >
                        Side by side
                      </button>
                      <button
                        type="button"
                        className={compareMode === 'overlay' ? 'active' : ''}
                        onClick={() => setCompareMode('overlay')}
                        disabled={!showJobReference || !hasGenerated}
                      >
                        Before / after
                      </button>
                    </div>
                    {referenceInfo && referenceInfo.available.length > 1 ? (
                      <label className="reference-select">
                        Reference
                        <select
                          value={referenceInfo.active}
                          onChange={(e) => {
                            if (!job) return
                            const source = e.target.value
                            void setReference(job.id, source)
                              .then(() => {
                                setReferenceTick((n) => n + 1)
                                appLog(`Reference mesh → ${source.split('/').pop()}`)
                              })
                              .catch((err: Error) => reportError(err.message))
                          }}
                          title="Which mesh is the reconstruction reference"
                        >
                          {referenceInfo.available.map((src) => (
                            <option key={src} value={src}>
                              {src === 'outputs/reference.stl'
                                ? 'reference.stl (default)'
                                : (src.split('/').pop() ?? src)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {compareMode === 'overlay' && showJobReference && hasGenerated ? (
                      <div className="overlay-sliders">
                        <label>
                          Reference
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={refOpacity}
                            onChange={(e) => setRefOpacity(Number(e.target.value))}
                          />
                        </label>
                        <label>
                          Generated
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={genOpacity}
                            onChange={(e) => setGenOpacity(Number(e.target.value))}
                          />
                        </label>
                      </div>
                    ) : null}
                    {compareMode === 'overlay' && showJobReference && hasGenerated ? (
                      <div className="align-controls">
                        <button
                          type="button"
                          className={`viewport-btn${compareAlignOpen ? ' active' : ''}`}
                          aria-expanded={compareAlignOpen}
                          onClick={() =>
                            setCompareAlignOpen((v) => {
                              if (v) setCompareNudgeOpen(false)
                              return !v
                            })
                          }
                          title={
                            compareAlignOpen
                              ? 'Hide align tools'
                              : 'Show align tools'
                          }
                        >
                          Align tools
                        </button>
                        {compareAlignOpen ? (
                          <>
                            <button
                              type="button"
                              className="viewport-btn"
                              disabled={alignBusy}
                              onClick={() => {
                                if (!job) return
                                setAlignBusy(true)
                                setAlignError(null)
                                alignJob(job.id)
                                  .then((res) => {
                                    setAlignResult(res)
                                    setHeatmapOn(true)
                                  })
                                  .catch((e: Error) => setAlignError(e.message))
                                  .finally(() => setAlignBusy(false))
                              }}
                              title="ICP-align generated mesh onto reference and compute deviation"
                            >
                              {alignBusy
                                ? 'Aligning…'
                                : alignResult
                                  ? 'Re-align'
                                  : 'Align'}
                            </button>
                            <button
                              type="button"
                              className={`viewport-btn${heatmapOn ? ' active' : ''}`}
                              disabled={!alignResult}
                              onClick={() => setHeatmapOn((v) => !v)}
                              title="Color generated mesh by distance to reference"
                            >
                              Heatmap
                            </button>
                            <button
                              type="button"
                              className="viewport-btn"
                              disabled={!alignResult && !alignError}
                              onClick={() => {
                                // Clear alignment state; keep the tools panel open.
                                setAlignResult(null)
                                setHeatmapOn(false)
                                setAlignError(null)
                                setNudge({
                                  translate: [0, 0, 0],
                                  rotateDeg: [0, 0, 0],
                                  scale: 1,
                                })
                              }}
                              title="Clear alignment and nudge (keeps tools open)"
                            >
                              Reset
                            </button>
                            {alignResult ? (
                              <span className="align-stats muted">
                                mean {alignResult.stats.mean?.toFixed(2) ?? '—'}mm · p95{' '}
                                {alignResult.stats.p95?.toFixed(2) ?? '—'}mm · max{' '}
                                {alignResult.stats.max?.toFixed(2) ?? '—'}mm
                              </span>
                            ) : null}
                            {alignError ? (
                              <span className="align-error">{alignError}</span>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {compareMode === 'overlay' &&
                    showJobReference &&
                    hasGenerated &&
                    compareAlignOpen ? (
                      <div className="nudge-controls">
                        <button
                          type="button"
                          className="viewport-btn"
                          aria-expanded={compareNudgeOpen}
                          onClick={() => setCompareNudgeOpen((v) => !v)}
                        >
                          Manual nudge
                        </button>
                        {compareNudgeOpen ? (
                          <>
                            {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                              <label key={`t-${axis}`}>
                                T{axis}
                                <input
                                  type="range"
                                  min={-10}
                                  max={10}
                                  step={0.1}
                                  value={nudge.translate[i]}
                                  onChange={(e) => {
                                    const v = Number(e.target.value)
                                    setNudge((n) => {
                                      const t = [...n.translate] as [
                                        number,
                                        number,
                                        number,
                                      ]
                                      t[i] = v
                                      return { ...n, translate: t }
                                    })
                                  }}
                                />
                                <span className="nudge-val">
                                  {nudge.translate[i].toFixed(1)}
                                </span>
                              </label>
                            ))}
                            {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                              <label key={`r-${axis}`}>
                                R{axis}°
                                <input
                                  type="range"
                                  min={-180}
                                  max={180}
                                  step={1}
                                  value={nudge.rotateDeg[i]}
                                  onChange={(e) => {
                                    const v = Number(e.target.value)
                                    setNudge((n) => {
                                      const r = [...n.rotateDeg] as [
                                        number,
                                        number,
                                        number,
                                      ]
                                      r[i] = v
                                      return { ...n, rotateDeg: r }
                                    })
                                  }}
                                />
                                <span className="nudge-val">
                                  {nudge.rotateDeg[i].toFixed(0)}
                                </span>
                              </label>
                            ))}
                            <label>
                              Scale
                              <input
                                type="range"
                                min={0.8}
                                max={1.2}
                                step={0.005}
                                value={nudge.scale}
                                onChange={(e) =>
                                  setNudge((n) => ({
                                    ...n,
                                    scale: Number(e.target.value),
                                  }))
                                }
                              />
                              <span className="nudge-val">{nudge.scale.toFixed(3)}</span>
                            </label>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {compareMode === 'overlay' && showJobReference && hasGenerated ? (
                    <div className="compare compare-overlay">
                      <StlViewport
                        key={`${job.id}-overlay-${referenceArt?.mtime}-${generatedArt?.mtime}-${referenceTick}`}
                        url={jobFileUrl(job.id, 'outputs/generated.stl')}
                        overlayUrl={jobFileUrl(job.id, 'outputs/reference.stl')}
                        label="Before / after overlay"
                        accent="var(--mesh-gen)"
                        overlayAccent="var(--mesh-ref)"
                        primaryOpacity={genOpacity}
                        overlayOpacity={refOpacity}
                        downloads={generatedDownloads}
                        alignTransform={alignResult?.transform ?? null}
                        heatmap={
                          heatmapOn && alignResult
                            ? {
                                vertexIndices: alignResult.vertex_indices ?? undefined,
                                distances: alignResult.distances,
                              }
                            : null
                        }
                        nudge={nudge}
                      />
                    </div>
                  ) : (
                    <div className="compare">
                      {showJobReference ? (
                        <StlViewport
                          key={`${job.id}-ref-${referenceArt?.mtime ?? hasReference}-${referenceTick}`}
                          url={jobFileUrl(job.id, 'outputs/reference.stl')}
                          label="Reference mesh"
                          accent="var(--mesh-ref)"
                          downloads={[
                            {
                              label: 'STL',
                              onClick: () =>
                                void downloadAuth(
                                  job.id,
                                  'outputs/reference.stl',
                                  'reference.stl',
                                ),
                            },
                          ]}
                        />
                      ) : (
                        <div className="viewport-shell">
                          <div className="viewport-toolbar">
                            <span className="viewport-label">Reference mesh</span>
                          </div>
                          <div className="viewport placeholder">
                            {job.status === 'failed'
                              ? 'No reference mesh — job failed'
                              : jobRunning
                                ? 'Waiting for preprocess…'
                                : 'No reference mesh'}
                          </div>
                        </div>
                      )}
                      {hasGenerated ? (
                        <StlViewport
                          key={`${job.id}-gen-${generatedArt?.mtime ?? hasGenerated}`}
                          url={jobFileUrl(job.id, 'outputs/generated.stl')}
                          label="Generated mesh"
                          accent="var(--mesh-gen)"
                          downloads={generatedDownloads}
                          alignTransform={alignResult?.transform ?? null}
                          heatmap={
                            heatmapOn && alignResult
                              ? {
                                  vertexIndices: alignResult.vertex_indices ?? undefined,
                                  distances: alignResult.distances,
                                }
                              : null
                          }
                          nudge={nudge}
                        />
                      ) : (
                        <div className="viewport-shell">
                          <div className="viewport-toolbar">
                            <span className="viewport-label">Generated mesh</span>
                          </div>
                          <div className="viewport placeholder">
                            {job.status === 'failed'
                              ? 'No generated mesh — export did not complete'
                              : jobRunning
                                ? 'Waiting for export…'
                                : 'No generated mesh'}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              {detailTab === 'engine' ? (
                <div
                  role="tabpanel"
                  id="panel-engine"
                  aria-labelledby="tab-engine"
                >
                  <Suspense
                    fallback={
                      <div className="engine-shell idle panel-block">
                        <p className="muted">Loading Zoo Engine view…</p>
                      </div>
                    }
                  >
                    <ZooEngineView
                      kcl={kcl || null}
                      active={engineOn && Boolean(kcl)}
                      hasKcl={Boolean(kcl)}
                      jobStatus={job.status}
                      jobSeconds={jobSeconds}
                      onCopyKcl={() => {
                        if (!kcl) return
                        void navigator.clipboard.writeText(kcl).then(
                          () => appLog('Copied main.kcl to clipboard'),
                          () => reportError('Could not copy KCL'),
                        )
                      }}
                      onDownloadKcl={() => {
                        if (!job || !kcl) return
                        void downloadAuth(job.id, 'outputs/main.kcl', 'main.kcl')
                      }}
                    />
                  </Suspense>
                </div>
              ) : null}

              {detailTab === 'workbench' ? (
                <div
                  className="workbench"
                  role="tabpanel"
                  id="panel-workbench"
                  aria-labelledby="tab-workbench"
                >
                  <UsageMeter
                    jobSeconds={jobSeconds}
                    refreshKey={`${job.id}-${job.status}-${events.length}`}
                  />

                  <div className="panel-block snapshots">
                    <h3>Photos</h3>
                    {snapshots.length ? (
                      <div className="snap-grid">
                        {snapshots.map((s) => (
                          <figure key={`${s.path}-${s.mtime}`}>
                            <AuthImage
                              jobId={job.id}
                              path={s.path}
                              name={s.name}
                              alt={s.name}
                            />
                            <figcaption>
                              <span className="snap-caption-name">
                                {s.kind === 'reference_photo'
                                  ? `Reference · ${s.name}`
                                  : s.name.replace(/^agent_/, '')}
                              </span>
                              <button
                                type="button"
                                className="linkish"
                                onClick={() =>
                                  void downloadAuth(job.id, s.path, s.name)
                                }
                              >
                                Download
                              </button>
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">
                        Reference photos appear as soon as the job starts; Agent
                        snapshots fill in during the run.
                      </p>
                    )}
                  </div>

                  {metricChips.length ? (
                    <div className="metric-chips panel-block">
                      <div className="panel-head-row">
                        <h3>Metrics summary</h3>
                        <div className="view-toggle" role="group" aria-label="Volume unit">
                          {VOLUME_UNITS.map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              className={volumeUnit === u.id ? 'active' : ''}
                              onClick={() => {
                                setVolumeUnitState(u.id)
                                setVolumeUnit(u.id)
                              }}
                            >
                              {u.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <ul>
                        {metricChips.map((m) => (
                          <li key={m.label} title={m.tip}>
                            <span className="metric-label">
                              {m.label}
                              <em className="metric-tip" aria-hidden="true">
                                ?
                              </em>
                            </span>
                            <strong>{m.value}</strong>
                            <span className="metric-tooltip">{m.tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="workbench-quad">
                    <div className="panel-block">
                      <div className="panel-head-row">
                        <h3>Logs</h3>
                        <button
                          type="button"
                          className="linkish"
                          disabled={!filteredLogs.length}
                          onClick={() => {
                            const text = filteredLogs
                              .map(
                                (ev) =>
                                  `${ev.ts ?? ''} ${(ev.level || 'info').toUpperCase()} ${ev.message ?? ''}`,
                              )
                              .join('\n')
                            const blob = new Blob([text], { type: 'text/plain' })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `${job.id}-job.log`
                            a.click()
                            URL.revokeObjectURL(url)
                            appLog('Downloaded job log')
                          }}
                        >
                          Download
                        </button>
                      </div>
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
                      <div
                        className="log-panel"
                        role="log"
                        aria-live="polite"
                        ref={logPanelRef}
                        onScroll={(e) => {
                          const el = e.currentTarget
                          stickLogToBottom.current =
                            el.scrollHeight - el.scrollTop - el.clientHeight < 64
                        }}
                      >
                        {filteredLogs.length === 0 ? (
                          <p className="muted">No log events yet.</p>
                        ) : (
                          filteredLogs.map((ev, i) => (
                            <div
                              key={`${ev.ts}-${i}`}
                              className={`log-line ${ev.level || 'info'}`}
                            >
                              <span className="ts">{ev.ts?.slice(11, 19)}</span>
                              <span className="lvl">
                                {(ev.level || 'info').toUpperCase()}
                              </span>
                              <span className="msg">{ev.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="panel-block">
                      <div className="panel-head-row">
                        <h3>Assistant</h3>
                        <button
                          type="button"
                          className="linkish"
                          disabled={!assistantText.trim()}
                          onClick={() => {
                            const blob = new Blob([assistantText], {
                              type: 'text/markdown',
                            })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `${job.id}-assistant.md`
                            a.click()
                            URL.revokeObjectURL(url)
                            appLog('Downloaded assistant markdown')
                          }}
                        >
                          Download
                        </button>
                      </div>
                      <div className="assistant md-panel">
                        {assistantText.trim() ? (
                          <MarkdownView text={assistantText} />
                        ) : (
                          <p className="muted">No assistant notes yet.</p>
                        )}
                      </div>
                    </div>

                    <div className="panel-block">
                      <div className="panel-head-row">
                        <h3>Metrics</h3>
                        <div className="panel-head-actions">
                          <div className="view-toggle" role="group" aria-label="Metrics view">
                            <button
                              type="button"
                              className={metricsView === 'json' ? 'active' : ''}
                              onClick={() => setMetricsView('json')}
                            >
                              JSON
                            </button>
                            <button
                              type="button"
                              className={metricsView === 'table' ? 'active' : ''}
                              onClick={() => setMetricsView('table')}
                            >
                              Table
                            </button>
                          </div>
                          <button
                            type="button"
                            className="linkish"
                            disabled={!metrics}
                            onClick={() =>
                              void downloadAuth(
                                job.id,
                                'outputs/metrics.json',
                                'metrics.json',
                              )
                            }
                          >
                            Download
                          </button>
                        </div>
                      </div>
                      {!metrics ? (
                        <pre className="metrics muted-pre">(after measure step)</pre>
                      ) : metricsView === 'json' ? (
                        <pre
                          className="metrics code-hl"
                          dangerouslySetInnerHTML={{ __html: metricsHtml }}
                        />
                      ) : (
                        <div className="metrics-table-wrap">
                          <table className="metrics-table">
                            <thead>
                              <tr>
                                <th>Key</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {metricsTable.map((row) => (
                                <tr key={row.key}>
                                  <td>{row.key}</td>
                                  <td>{row.value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="panel-block">
                      <div className="panel-head-row">
                        <h3>main.kcl</h3>
                        <div className="panel-head-actions">
                          {initialKcl && initialKcl !== kcl ? (
                            <div className="view-toggle" role="group" aria-label="KCL view">
                              <button
                                type="button"
                                className={kclView === 'current' ? 'active' : ''}
                                onClick={() => setKclView('current')}
                              >
                                Current
                              </button>
                              <button
                                type="button"
                                className={kclView === 'diff' ? 'active' : ''}
                                onClick={() => setKclView('diff')}
                              >
                                Diff vs initial
                              </button>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className="linkish"
                            disabled={!kcl}
                            onClick={() =>
                              void downloadAuth(job.id, 'outputs/main.kcl', 'main.kcl')
                            }
                          >
                            Download
                          </button>
                        </div>
                      </div>
                      {!kcl ? (
                        <pre className="kcl muted-pre">
                          (available when job succeeds)
                        </pre>
                      ) : kclView === 'diff' && initialKcl ? (
                        <pre className="kcl kcl-diff">
                          {kclDiffLines.map((line, idx) =>
                            line.kind === 'gap' ? (
                              <span key={idx} className="diff-gap">
                                ⋮ {line.count} unchanged line{line.count === 1 ? '' : 's'}
                                {'\n'}
                              </span>
                            ) : (
                              <span key={idx} className={`diff-line diff-${line.kind}`}>
                                <span className="diff-sign">
                                  {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                                </span>
                                {line.text || ' '}
                                {'\n'}
                              </span>
                            ),
                          )}
                        </pre>
                      ) : (
                        <pre
                          className="kcl code-hl"
                          dangerouslySetInnerHTML={{ __html: kclHtml }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {detailTab === 'iterate' ? (
                <div
                  className="iterate-panel"
                  role="tabpanel"
                  id="panel-iterate"
                  aria-labelledby="tab-iterate"
                >
                  <div className="prompt-history">
                    <button
                      type="button"
                      className={`section-toggle${historyOpen ? ' open' : ''}`}
                      onClick={() => setHistoryOpen((v) => !v)}
                      aria-expanded={historyOpen}
                      aria-controls="prompt-history-panel"
                    >
                      <span className="section-toggle-label">
                        <span className="section-toggle-chevron" aria-hidden="true">
                          {historyOpen ? '▾' : '▸'}
                        </span>
                        <h3>Prompt history</h3>
                      </span>
                      <span className="section-toggle-meta">
                        {historyOpen
                          ? 'Hide'
                          : history.length === 0
                            ? 'Empty · show'
                            : `Show · ${history.length} ${history.length === 1 ? 'entry' : 'entries'}`}
                      </span>
                    </button>
                    {historyOpen ? (
                      <div id="prompt-history-panel">
                        {history.length ? (
                          <ol className="prompt-list">
                            {history.map((entry, i) => (
                              <li
                                key={`${entry.created_at}-${i}`}
                                className="prompt-item"
                              >
                                <div className="prompt-meta">
                                  <span className="prompt-role">{entry.role}</span>
                                  {entry.mode ? <span>{entry.mode}</span> : null}
                                  <span>{formatPromptTime(entry.created_at)}</span>
                                  <span>{entry.text.length} chars</span>
                                </div>
                                <p className="prompt-text">{entry.text}</p>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="muted">No prompts recorded for this job yet.</p>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <form className="refine" onSubmit={onRefine}>
                    <div className="refine-head">
                      <h3>Refine</h3>
                      <p className="muted">
                        Iterate on current main.kcl. Optionally re-attach photos and/or a
                        mesh for updated reference.
                      </p>
                    </div>
                    <label>
                      Snippet
                      <select
                        value={refineSnippetId}
                        disabled={!canRefine}
                        onChange={(e) => void applyRefineSnippet(e.target.value)}
                      >
                        <option value="">Custom instruction…</option>
                        {refineSnippets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                            {s.attach || s.hasFiles ? ' (package)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Instruction
                      <textarea
                        value={refine}
                        onChange={(e) =>
                          setRefine(e.target.value.slice(0, REFINE_MAX))
                        }
                        rows={3}
                        maxLength={REFINE_MAX}
                        disabled={!canRefine}
                        placeholder="e.g. Make the key-ring hole 4 mm and thicken the body to 3.5 mm"
                      />
                    </label>
                    <div className="row refine-files">
                      <label>
                        Photos (optional)
                        <input
                          type="file"
                          accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
                          multiple
                          disabled={!canRefine}
                          onChange={(e) => setRefinePhotos(e.target.files)}
                        />
                      </label>
                      <label>
                        Meshes (optional)
                        <input
                          type="file"
                          accept=".stl,.ply,.xyz,.txt,.obj,.3mf"
                          multiple
                          disabled={!canRefine}
                          onChange={(e) => setRefineMeshes(e.target.files)}
                        />
                      </label>
                    </div>
                    {refinePkgPhotos.length || refinePkgMeshes.length ? (
                      <div className="refine-package">
                        <span className="refine-package-label">Package attachments</span>
                        <div className="refine-package-chips">
                          {refinePkgPhotos.map((f) => (
                            <span
                              key={`p-${f.name}`}
                              className="attach-chip photo"
                              title={f.name}
                            >
                              {f.name}
                            </span>
                          ))}
                          {refinePkgMeshes.map((f) => (
                            <span
                              key={`m-${f.name}`}
                              className="attach-chip mesh"
                              title={f.name}
                            >
                              {f.name}
                            </span>
                          ))}
                          <button
                            type="button"
                            className="linkish refine-package-clear"
                            onClick={() => {
                              setRefinePkgPhotos([])
                              setRefinePkgMeshes([])
                              setRefineSnippetId('')
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <p className={`hint ${refineLen > REFINE_MAX * 0.9 ? 'warn' : ''}`}>
                      {refineHint}
                      {refineAttachHint ? ` · attaching ${refineAttachHint}` : ''}
                      {jobRunning
                        ? ' · wait for the current run to finish (or cancel it)'
                        : !hasKcl
                          ? ' · needs main.kcl from a completed reconstruction'
                          : ' · continues the Zoo conversation when possible'}
                    </p>
                    <div className="refine-actions">
                      <button
                        type="submit"
                        className="primary"
                        disabled={!canRefine || !refine.trim()}
                      >
                        Send refine
                      </button>
                    </div>
                  </form>

                  <form className="refine finish" onSubmit={onApplyFinish}>
                    <div className="refine-head">
                      <h3>Apply finish</h3>
                      <p className="muted">
                        Set a PBR surface look on the last solid via KCL{' '}
                        <code>appearance()</code>, then re-export. No Agent call — opens
                        Live Engine so you can judge the material.
                      </p>
                    </div>
                    <label>
                      Finish
                      <select
                        value={finishId}
                        onChange={(e) => setFinishId(e.target.value)}
                        disabled={!canRefine || finishes.length === 0}
                      >
                        {finishes.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedFinish ? (
                      <div className="finish-preview">
                        <span
                          className="finish-swatch"
                          style={{ background: selectedFinish.color }}
                          aria-hidden
                        />
                        <p className="muted">
                          {selectedFinish.description}. metalness{' '}
                          {selectedFinish.metalness}, roughness{' '}
                          {selectedFinish.roughness}
                          {selectedFinish.opacity != null
                            ? `, opacity ${selectedFinish.opacity}`
                            : ''}
                          .
                        </p>
                      </div>
                    ) : null}
                    <div className="refine-actions">
                      <button
                        type="submit"
                        className="primary"
                        disabled={!canRefine || !finishId || finishes.length === 0}
                      >
                        Apply finish
                      </button>
                    </div>
                  </form>
                </div>
              ) : null}
            </section>
          ) : (
            <section className="panel detail empty-detail">
              <p className="eyebrow">Ready when you are</p>
              <h2>Start a reconstruction</h2>
              <p className="muted">
                Load a packaged demo, or upload your own photo + mesh (STL / PLY / OBJ /
                3MF / XYZ). Jobs appear in the list so you can compare, refine, and export.
              </p>
              <div className="empty-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setCreateError(null)
                    setCreatePane('upload')
                    setCreateOpen(true)
                  }}
                >
                  New job
                </button>
                {demos[0] ? (
                  <button type="button" onClick={() => void onDemo(demos[0])}>
                    Load “{demos[0].title}”
                  </button>
                ) : null}
              </div>
            </section>
          )}
        </main>
      </div>

      {createOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false)
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-job-title"
          >
            <div className="modal-head">
              <h2 id="new-job-title">New job</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setCreateOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="view-toggle" role="group" aria-label="Create job source">
              <button
                type="button"
                className={createPane === 'upload' ? 'active' : ''}
                onClick={() => setCreatePane('upload')}
              >
                Upload
              </button>
              <button
                type="button"
                className={createPane === 'demo' ? 'active' : ''}
                onClick={() => setCreatePane('demo')}
              >
                Demo
              </button>
            </div>
            {createPane === 'upload' ? (
              <form onSubmit={onCreate} className="create-form">
                <div className="template-row">
                  <span className="muted">Prompt templates</span>
                  <div className="template-pills">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => applyTemplate(t)}
                        title={t.prompt.slice(0, 120)}
                      >
                        {t.title}
                        {t.builtin ? null : <span className="tpl-custom">Custom</span>}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  Title
                  <input
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value.slice(0, 80))}
                    placeholder="e.g. Beverage holder stand"
                    maxLength={80}
                  />
                </label>
                <label>
                  Prompt
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
                    rows={4}
                    required
                    maxLength={PROMPT_MAX}
                  />
                  <span className={`hint ${promptLen > PROMPT_WARN ? 'warn' : ''}`}>
                    {promptHint}
                  </span>
                </label>
                <div className="row">
                  <label>
                    Agent mode
                    <select value={mode} onChange={(e) => setMode(e.target.value)}>
                      {MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="create-inputs">
                  <h3>Inputs</h3>
                  <label>
                    Photos (JPG / PNG / WebP / HEIC)
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
                      multiple
                      onChange={(e) => setPhotos(e.target.files)}
                    />
                    {photos?.length ? (
                      <div className="file-chips">
                        {Array.from(photos).map((f) => (
                          <span key={f.name} className="attach-chip photo" title={f.name}>
                            {f.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </label>
                  <label>
                    Meshes (STL / PLY / OBJ / 3MF / XYZ)
                    <input
                      type="file"
                      accept=".stl,.ply,.xyz,.txt,.obj,.3mf"
                      multiple
                      onChange={(e) => setMeshes(e.target.files)}
                    />
                    {meshes?.length ? (
                      <div className="file-chips">
                        {Array.from(meshes).map((f) => (
                          <span key={f.name} className="attach-chip mesh" title={f.name}>
                            {f.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </label>
                </div>

                {showLocalReference ? (
                  <div className="local-preview">
                    <StlViewport
                      url={localMeshUrl!}
                      label="Reference preview"
                      accent="var(--mesh-ref)"
                      compact
                    />
                    <p className="muted">
                      STL preview (other formats convert on upload)
                    </p>
                  </div>
                ) : null}

                {createError ? (
                  <div className="form-error" role="alert">
                    {createError}
                  </div>
                ) : null}

                <button type="submit" className="primary" disabled={creating}>
                  {creating ? 'Starting…' : 'Start reconstruction'}
                </button>
              </form>
            ) : demos.length ? (
              <div className="demos">
                <h3>Demos</h3>
                <div className="demo-list">
                  {demos.map((d) => (
                    <div key={d.id} className="demo-item">
                      <button
                        type="button"
                        disabled={creating}
                        onClick={() => void onDemo(d)}
                      >
                        {creating ? 'Starting…' : `Load “${d.title}”`}
                      </button>
                      {d.description ? (
                        <p className="muted demo-desc">{d.description}</p>
                      ) : null}
                      {d.source_url ? (
                        <a
                          className="demo-source"
                          href={d.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {d.source_label || 'Original design'}
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
                {createError ? (
                  <div className="form-error" role="alert">
                    {createError}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="muted">No demos available.</p>
            )}
          </div>
        </div>
      ) : null}

      {deleteConfirmId ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteConfirmId(null)
          }}
        >
          <div
            className="modal delete-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-job-title"
          >
            <h2 id="delete-job-title">
              Delete{' '}
              {jobs.find((j) => j.id === deleteConfirmId)?.title ??
                (job?.id === deleteConfirmId ? job.title : deleteConfirmId)}
              ?
            </h2>
            <p className="muted">This removes the job and all its files.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setDeleteConfirmId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void confirmDeleteJob()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ApiAccountModal
        open={apiAccountOpen}
        onClose={() => setApiAccountOpen(false)}
        onTokenChange={onTokenChange}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
          setTemplates(listPromptTemplates())
          void listRefineSnippets().then(setRefineSnippets).catch(() => undefined)
        }}
        onLibraryChange={() => {
          setTemplates(listPromptTemplates())
          void listRefineSnippets().then(setRefineSnippets).catch(() => undefined)
        }}
      />
      <JobsModal
        open={jobsModalOpen}
        jobs={jobs}
        engineSessions={engineSessions}
        onClose={() => setJobsModalOpen(false)}
        onNewJob={() => {
          setJobsModalOpen(false)
          setCreateError(null)
          setCreatePane('upload')
          setCreateOpen(true)
        }}
        onSelectJob={(id) => {
          setSelectedId(id)
          setJobsModalOpen(false)
          setJobsDrawerOpen(false)
        }}
        onDeleteJob={(id) => onDeleteJob(id)}
        onRetryJob={(id) => {
          setJobsModalOpen(false)
          void onRetryJob(id)
        }}
        onCancelJob={(id) => void onCancelJobById(id)}
        onStopEngine={onStopEngine}
      />
    </div>
  )
}
