import { Client } from '@kittycad/lib'
import { ZooWebView } from '@kittycad/web-view'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { hexToRgb01, parseLastAppearance } from './appearance'
import { getApiToken, saveJobKcl, type Job } from './api'
import { appLog } from './appLog'
import { KclEditor } from './KclEditor'
import { formatKcl } from './kclWasm'
import {
  IconCamera,
  IconCode,
  IconCopy,
  IconEdges,
  IconErrors,
  IconExpand,
  IconExplode,
  IconExport,
  IconFit,
  IconPan,
  IconPlay,
  IconRefresh,
  IconRotate,
  IconScaleDown,
  IconScaleUp,
  IconStop,
  IconValues,
  IconXray,
  IconZoomIn,
  IconZoomOut,
} from './EngineIcons'
import {
  CAMERA_VIEWS,
  downloadExportFromResponse,
  entityIdsFromResponse,
  explodeOffsets,
  executorErrorsFromResult,
  executorValuesFromResult,
  EXPORT_FORMATS,
  extractSnapshotDataUrl,
  modelingErrorMessage,
  outputFormatForExport,
  selectionSummary,
  sendModelingBatch,
  sendModelingCmd,
  waitFrame,
  type CameraViewKey,
  type ExplodeMode,
  type ExportFormat,
  type RtcSender,
} from './engineRtc'
import {
  registerEngineSession,
  unregisterEngineSession,
} from './engineSessions'
import { UsageMeter } from './UsageMeter'

type Props = {
  kcl: string | null
  active: boolean
  /** Whether main.kcl is available (may differ from active when Live engine is off). */
  hasKcl: boolean
  jobId: string
  jobTitle: string
  /** Current job status — used for idle messaging when KCL is missing. */
  jobStatus?: string
  jobSeconds?: number | null
  onCopyKcl?: () => void
  onDownloadKcl?: () => void
  onSessionSeconds?: (seconds: number) => void
  /** Called after a successful Save so the app can refresh committed KCL / job meta. */
  onKclSaved?: (kcl: string, job: Job) => void
}

type KclExecutor = {
  submit: (
    source: string | Map<string, string>,
    opts?: { mainKclPathName?: string },
  ) => Promise<unknown>
}

type TouchGesture = {
  type: 'rotate' | 'pan'
  interaction: 'rotatetrackball' | 'pan'
  lastCenter: { x: number; y: number }
  lastDistance: number
}

type ToolbarMode = 'compact' | 'full'

function IconBtn({
  label,
  active,
  disabled,
  onClick,
  children,
  primary,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  primary?: boolean
}) {
  return (
    <button
      type="button"
      className={`engine-icon-btn${active ? ' active' : ''}${primary ? ' primary' : ''}`}
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
      <span className="engine-icon-label">{label}</span>
    </button>
  )
}

/**
 * Live Zoo Engine WebRTC preview — compact by default; full tools in the large viewer.
 */
export function ZooEngineView({
  kcl,
  active,
  hasKcl,
  jobId,
  jobTitle,
  jobStatus,
  jobSeconds,
  onCopyKcl,
  onDownloadKcl,
  onSessionSeconds,
  onKclSaved,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const popupHostRef = useRef<HTMLDivElement | null>(null)
  const rtcRef = useRef<RtcSender | null>(null)
  const executorRef = useRef<KclExecutor | null>(null)
  const solidIdsRef = useRef<string[]>([])
  const explodeOffsetRef = useRef<Record<string, { x: number; y: number; z: number }>>({})
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>())
  const touchGestureRef = useRef<TouchGesture | null>(null)
  const streamSizeRef = useRef({ width: 640, height: 384 })

  const committed = kcl ?? ''
  const [draft, setDraft] = useState(committed)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const dirty = draft !== committed
  const [saveBusy, setSaveBusy] = useState(false)
  const [runBusy, setRunBusy] = useState(false)
  const [formatBusy, setFormatBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(true)
  const [reexportOnSave, setReexportOnSave] = useState(false)

  const [status, setStatus] = useState('Idle')
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [popup, setPopup] = useState(false)
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [ready, setReady] = useState(false)
  const [edgesOn, setEdgesOn] = useState(true)
  const [panMode, setPanMode] = useState(false)
  const [rotateMode, setRotateMode] = useState(false)
  const panModeRef = useRef(false)
  const rotateModeRef = useRef(false)
  const objectScaleRef = useRef(1)
  const [objectScale, setObjectScale] = useState(1)
  const [xrayOn, setXrayOn] = useState(false)
  const [xrayOpacity, setXrayOpacity] = useState(0.22)
  const [explodeMode, setExplodeMode] = useState<ExplodeMode | null>(null)
  const [explodeSpacing, setExplodeSpacing] = useState(12)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [busyNote, setBusyNote] = useState<string | null>(null)
  const [selectionInfo, setSelectionInfo] = useState<string | null>(null)
  const [execValues, setExecValues] = useState<unknown>(null)
  const [execErrors, setExecErrors] = useState<string[]>([])
  const [inspector, setInspector] = useState<'none' | 'values' | 'errors'>('none')
  const [snapUrls, setSnapUrls] = useState<Partial<Record<CameraViewKey, string>>>({})
  const [snapBusy, setSnapBusy] = useState(false)
  const connectedAt = useRef<number | null>(null)

  // Only list in All jobs after Start — visiting the Live Engine tab is not a session.
  useEffect(() => {
    if (!connected || !jobId) return
    registerEngineSession(jobId, jobTitle)
    return () => unregisterEngineSession(jobId)
  }, [connected, jobId, jobTitle])

  // Keep the draft aligned with disk when the user hasn't edited locally.
  useEffect(() => {
    if (!dirty) setDraft(committed)
  }, [committed, dirty])

  useEffect(() => {
    if (!connected) {
      connectedAt.current = null
      setSessionSeconds(0)
      onSessionSeconds?.(0)
      return
    }
    connectedAt.current = Date.now()
    const id = window.setInterval(() => {
      if (!connectedAt.current) return
      const sec = (Date.now() - connectedAt.current) / 1000
      setSessionSeconds(sec)
      onSessionSeconds?.(sec)
    }, 500)
    return () => window.clearInterval(id)
  }, [connected, onSessionSeconds])

  async function withRtc(label: string, fn: (rtc: RtcSender) => Promise<void>) {
    const rtc = rtcRef.current
    if (!rtc) {
      setBusyNote('Start a live session first')
      return
    }
    try {
      setBusyNote(label)
      setError(null)
      await fn(rtc)
      setBusyNote(null)
    } catch (err) {
      setBusyNote(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function zoomToFit(rtc: RtcSender) {
    await sendModelingBatch(rtc, [
      { type: 'zoom_to_fit', object_ids: [], padding: 0.05 },
    ])
  }

  async function cameraZoom(rtc: RtcSender, magnitude: number) {
    await sendModelingCmd(rtc, {
      type: 'default_camera_zoom',
      magnitude,
    })
  }

  /** Nudge the camera with a short drag (screen-space pixels). */
  async function cameraDragNudge(
    rtc: RtcSender,
    interaction: 'pan' | 'rotatetrackball',
    dx: number,
    dy: number,
  ) {
    const { width, height } = streamSizeRef.current
    const origin = { x: Math.round(width / 2), y: Math.round(height / 2) }
    const target = {
      x: Math.round(origin.x + dx),
      y: Math.round(origin.y + dy),
    }
    await sendModelingCmd(rtc, {
      type: 'camera_drag_start',
      interaction,
      window: origin,
    })
    await sendModelingCmd(rtc, {
      type: 'camera_drag_move',
      interaction,
      window: target,
    })
    await sendModelingCmd(rtc, {
      type: 'camera_drag_end',
      interaction,
      window: target,
    })
  }

  async function cameraPanNudge(rtc: RtcSender, dx: number, dy: number) {
    await cameraDragNudge(rtc, 'pan', dx, dy)
  }

  async function cameraRotateNudge(rtc: RtcSender, dx: number, dy: number) {
    await cameraDragNudge(rtc, 'rotatetrackball', dx, dy)
  }

  async function scaleObjects(rtc: RtcSender, factor: number) {
    let ids = solidIdsRef.current
    if (!ids.length) ids = await refreshSolidIds(rtc)
    if (!ids.length) return
    const next = Math.max(0.25, Math.min(4, objectScaleRef.current * factor))
    const relative = next / objectScaleRef.current
    if (Math.abs(relative - 1) < 1e-6) return
    await sendModelingBatch(
      rtc,
      ids.map((object_id) => ({
        type: 'set_object_transform',
        object_id,
        transforms: [
          {
            translate: null,
            rotate_rpy: null,
            rotate_angle_axis: null,
            scale: {
              origin: { type: 'local' },
              property: { x: relative, y: relative, z: relative },
              set: false,
            },
          },
        ],
      })),
    )
    objectScaleRef.current = next
    setObjectScale(next)
  }

  async function resetObjectScale(rtc: RtcSender) {
    const current = objectScaleRef.current
    if (Math.abs(current - 1) < 1e-6) return
    await scaleObjects(rtc, 1 / current)
  }

  async function refreshSolidIds(rtc: RtcSender) {
    const res = await sendModelingCmd(rtc, {
      type: 'scene_get_entity_ids',
      filter: ['solid3d'],
      skip: 0,
      take: 1000,
    })
    solidIdsRef.current = entityIdsFromResponse(res)
    return solidIdsRef.current
  }

  async function applyEdges(rtc: RtcSender, visible: boolean) {
    await sendModelingBatch(rtc, [{ type: 'edge_lines_visible', hidden: !visible }])
  }

  async function applyXray(rtc: RtcSender, enabled: boolean, opacity: number) {
    let ids = solidIdsRef.current
    if (!ids.length) ids = await refreshSolidIds(rtc)
    if (!ids.length) return
    await sendModelingBatch(rtc, [
      { type: 'set_order_independent_transparency', enabled },
      ...ids.map((object_id) => ({
        type: 'object_set_material_params_pbr',
        object_id,
        color: { r: 1, g: 1, b: 1, a: enabled ? opacity : 1 },
        metalness: 0,
        roughness: enabled ? 0.35 : 0.2,
        ambient_occlusion: 0,
      })),
    ])
  }

  /**
   * Push KCL appearance() onto every solid via RTC. Some programs leave intermediate
   * bodies in the scene; this makes Apply finish visually obvious in Live Engine.
   */
  async function applyAppearanceFromKcl(rtc: RtcSender, source: string) {
    const mat = parseLastAppearance(source)
    if (!mat) return
    let ids = solidIdsRef.current
    if (!ids.length) ids = await refreshSolidIds(rtc)
    if (!ids.length) return
    const rgb = hexToRgb01(mat.color)
    const a = Math.max(0, Math.min(1, mat.opacity / 100))
    const metalness = Math.max(0, Math.min(1, mat.metalness / 100))
    const roughness = Math.max(0, Math.min(1, mat.roughness / 100))
    await sendModelingBatch(rtc, [
      { type: 'set_order_independent_transparency', enabled: a < 0.999 },
      ...ids.map((object_id) => ({
        type: 'object_set_material_params_pbr',
        object_id,
        color: { r: rgb.r, g: rgb.g, b: rgb.b, a },
        metalness,
        roughness,
        ambient_occlusion: 0,
      })),
    ])
  }

  async function applyExplode(
    rtc: RtcSender,
    mode: ExplodeMode | null,
    spacing: number,
  ) {
    let ids = solidIdsRef.current
    if (!ids.length) ids = await refreshSolidIds(rtc)
    if (!ids.length) return
    const targets = mode
      ? explodeOffsets(mode, ids, spacing)
      : Object.fromEntries(ids.map((id) => [id, { x: 0, y: 0, z: 0 }]))
    const requests: Record<string, unknown>[] = []
    for (const object_id of ids) {
      const target = targets[object_id] ?? { x: 0, y: 0, z: 0 }
      const current = explodeOffsetRef.current[object_id] ?? { x: 0, y: 0, z: 0 }
      const delta = {
        x: target.x - current.x,
        y: target.y - current.y,
        z: target.z - current.z,
      }
      if (!delta.x && !delta.y && !delta.z) continue
      requests.push({
        type: 'set_object_transform',
        object_id,
        transforms: [
          {
            translate: {
              origin: { type: 'local' },
              property: delta,
              set: false,
            },
            rotate_rpy: null,
            rotate_angle_axis: null,
            scale: null,
          },
        ],
      })
    }
    explodeOffsetRef.current = targets
    if (requests.length) await sendModelingBatch(rtc, requests)
  }

  async function setCameraView(rtc: RtcSender, key: CameraViewKey) {
    const view = CAMERA_VIEWS.find((v) => v.key === key)
    if (!view) return
    await sendModelingBatch(rtc, [
      {
        type: 'default_camera_look_at',
        center: { x: 0, y: 0, z: 0 },
        vantage: view.vantage,
        up: view.up,
      },
      { type: 'zoom_to_fit', object_ids: [], padding: 0.1 },
    ])
  }

  async function prepareStream(rtc: RtcSender, width: number, height: number) {
    const w = Math.max(4, Math.floor(width / 4) * 4)
    const h = Math.max(4, Math.floor(height / 4) * 4)
    streamSizeRef.current = { width: w, height: h }
    try {
      await sendModelingCmd(rtc, {
        type: 'reconfigure_stream',
        width: w,
        height: h,
        fps: 30,
      })
    } catch {
      /* optional on some sessions */
    }
    await waitFrame(160)
  }

  async function takeSnapshotUrl(rtc: RtcSender): Promise<string> {
    const { width, height } = streamSizeRef.current
    await prepareStream(rtc, width, height)
    const res = await sendModelingCmd(rtc, { type: 'take_snapshot', format: 'png' })
    const fail = modelingErrorMessage(res)
    if (fail) throw new Error(fail)
    const url = extractSnapshotDataUrl(res)
    if (!url) {
      throw new Error(
        'Snapshot returned no image — try Zoom fit, then Capture again after the model settles.',
      )
    }
    return url
  }

  async function capturePng(rtc: RtcSender) {
    const url = await takeSnapshotUrl(rtc)
    const a = document.createElement('a')
    a.href = url
    a.download = 'engine-snapshot.png'
    a.click()
    appLog('Downloaded engine PNG snapshot')
  }

  async function refreshSnapshotRail(rtc: RtcSender) {
    setSnapBusy(true)
    try {
      const host = (popup ? popupHostRef.current : hostRef.current) ?? hostRef.current
      const w = host?.clientWidth || streamSizeRef.current.width
      const h = Math.max(220, Math.floor((host?.clientHeight || 280) * 0.55))
      await prepareStream(rtc, Math.max(160, Math.floor(w * 0.28)), h)

      const next: Partial<Record<CameraViewKey, string>> = {}
      for (const view of CAMERA_VIEWS) {
        await sendModelingCmd(rtc, {
          type: 'default_camera_look_at',
          center: { x: 0, y: 0, z: 0 },
          vantage: view.vantage,
          up: view.up,
        })
        await sendModelingCmd(rtc, {
          type: 'zoom_to_fit',
          object_ids: [],
          padding: -0.1,
        })
        await waitFrame(180)
        const snap = await sendModelingCmd(rtc, {
          type: 'take_snapshot',
          format: 'png',
        })
        const url = extractSnapshotDataUrl(snap)
        if (url) next[view.key] = url
      }
      setSnapUrls(next)
      const hostFull = popup ? popupHostRef.current : hostRef.current
      await prepareStream(
        rtc,
        hostFull?.clientWidth || 640,
        popup ? 640 : 384,
      )
      await zoomToFit(rtc)
      if (!Object.keys(next).length) {
        throw new Error('Could not build view snapshots yet — wait for the model, then retry.')
      }
    } finally {
      setSnapBusy(false)
    }
  }

  async function exportFormat(rtc: RtcSender, format: ExportFormat) {
    setExportBusy(true)
    setExportOpen(false)
    try {
      const res = await sendModelingCmd(rtc, {
        type: 'export3d',
        entity_ids: [],
        format: outputFormatForExport(format),
      })
      const name = downloadExportFromResponse(res)
      if (name) {
        appLog(`Engine exported ${name}`)
        setBusyNote(`Downloaded ${name}`)
      } else {
        const fail = modelingErrorMessage(res)
        if (fail) throw new Error(fail)
        setBusyNote(`${format.toUpperCase()} export requested`)
      }
    } finally {
      setExportBusy(false)
    }
  }

  async function finishSceneAfterSubmit(rtc: RtcSender, source: string) {
    await zoomToFit(rtc)
    await refreshSolidIds(rtc)
    await applyEdges(rtc, edgesOn)
    if (xrayOn) {
      await applyXray(rtc, true, xrayOpacity)
    } else {
      await applyAppearanceFromKcl(rtc, source)
    }
    if (explodeMode) await applyExplode(rtc, explodeMode, explodeSpacing)
    setStatus('Capturing view snaps…')
    await refreshSnapshotRail(rtc)
  }

  async function submitDraft(source: string) {
    const executor = executorRef.current
    const rtc = rtcRef.current
    if (!executor || !rtc) {
      setBusyNote('Start a live session first')
      return
    }
    if (!source.trim()) {
      setError('KCL is empty — nothing to run')
      return
    }
    setRunBusy(true)
    setError(null)
    setStatus('Executing KCL…')
    setBusyNote('Running draft…')
    try {
      const result = await executor.submit(source, { mainKclPathName: 'main.kcl' })
      setExecValues(executorValuesFromResult(result))
      const errs = executorErrorsFromResult(result)
      setExecErrors(errs)
      if (errs.length) setInspector('errors')
      try {
        await finishSceneAfterSubmit(rtc, source)
      } catch (err) {
        setBusyNote(
          err instanceof Error ? err.message : 'Scene setup finished with warnings',
        )
      }
      setStatus('Live')
      setBusyNote(null)
      appLog('Live Engine ran KCL draft')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('Failed')
      setBusyNote(null)
    } finally {
      setRunBusy(false)
    }
  }

  function onRunDraft() {
    const source = draftRef.current
    if (!source.trim()) {
      setError('KCL is empty — nothing to run')
      return
    }
    if (!connected) {
      setConnected(true)
      return
    }
    if (!ready) {
      setBusyNote('Engine is still connecting…')
      return
    }
    void submitDraft(source)
  }

  async function onSaveDraft() {
    const source = draftRef.current
    if (!source.trim()) {
      setError('KCL is empty — nothing to save')
      return
    }
    if (!dirty) {
      setBusyNote('No local changes to save')
      return
    }
    setSaveBusy(true)
    setError(null)
    try {
      const result = await saveJobKcl(jobId, source, { reexport: reexportOnSave })
      onKclSaved?.(result.kcl, result.job)
      setDraft(result.kcl)
      setBusyNote(
        reexportOnSave
          ? 'Saved main.kcl — re-exporting meshes for Compare…'
          : 'Saved main.kcl (previous archived in kcl_history/)',
      )
      appLog(
        reexportOnSave
          ? 'Saved main.kcl and queued re-export'
          : 'Saved main.kcl from Live Engine editor',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaveBusy(false)
    }
  }

  function onDiscardDraft() {
    setDraft(committed)
    setBusyNote('Discarded local edits')
  }

  async function onFormatDraft() {
    const source = draftRef.current
    if (!source.trim()) {
      setError('KCL is empty — nothing to format')
      return
    }
    setFormatBusy(true)
    setError(null)
    try {
      const formatted = await formatKcl(source)
      setDraft(formatted)
      setBusyNote(
        formatted === source ? 'Already formatted' : 'Formatted KCL with Zoo recast',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFormatBusy(false)
    }
  }

  useEffect(() => {
    const source = draftRef.current
    if (!active || !connected || !source.trim()) {
      rtcRef.current = null
      executorRef.current = null
      setReady(false)
      setStatus(
        !active
          ? 'Idle'
          : !connected
            ? 'Disconnected — start a session when ready'
            : 'Waiting for main.kcl…',
      )
      return
    }
    const host = popup ? popupHostRef.current : hostRef.current
    if (!host) return

    const token = getApiToken()
    if (!token) {
      setError('Save a Zoo API token to start the live engine view.')
      return
    }

    let cancelled = false
    let view: ZooWebView | null = null
    setError(null)
    setReady(false)
    setSelectionInfo(null)
    setExecValues(null)
    setExecErrors([])
    setSnapUrls({})
    solidIdsRef.current = []
    explodeOffsetRef.current = {}
    objectScaleRef.current = 1
    setObjectScale(1)
    setStatus('Connecting to Zoo Engine…')

    const width = Math.max(
      320,
      Math.floor((host.clientWidth || (popup ? 960 : 640)) / 4) * 4,
    )
    const height = popup ? 640 : 384
    streamSizeRef.current = { width, height }

    try {
      const zooClient = new Client({
        token,
        baseUrl: 'wss://api.zoo.dev',
      })
      view = new ZooWebView({
        zooClient,
        size: { width, height },
        autoStart: true,
        allowMultiple: false,
      })
      host.replaceChildren(view.el)

      const onReady = () => {
        if (cancelled || !view?.rtc) return
        const rtc = view.rtc as unknown as RtcSender
        rtcRef.current = rtc
        const executor = view.rtc.executor() as KclExecutor
        executorRef.current = executor
        setReady(true)
        const toRun = draftRef.current
        setStatus('Executing KCL…')
        void executor
          .submit(toRun, { mainKclPathName: 'main.kcl' })
          .then(async (result) => {
            if (cancelled) return
            setExecValues(executorValuesFromResult(result))
            const errs = executorErrorsFromResult(result)
            setExecErrors(errs)
            if (errs.length) setInspector('errors')
            try {
              await finishSceneAfterSubmit(rtc, toRun)
            } catch (err) {
              if (!cancelled) {
                setBusyNote(
                  err instanceof Error ? err.message : 'Scene setup finished with warnings',
                )
              }
            }
            if (!cancelled) setStatus('Live')
          })
          .catch((err: unknown) => {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : String(err))
              setStatus('Failed')
            }
          })
      }
      view.addEventListener('ready', onReady)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('Failed')
    }

    return () => {
      cancelled = true
      rtcRef.current = null
      executorRef.current = null
      setReady(false)
      if (view) {
        void view.deconstructor()
        view.el.remove()
      }
      host.replaceChildren()
    }
    // Reconnect only for session lifecycle — not on every draft keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, connected, popup])

  useEffect(() => {
    if (!popup) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopup(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popup])

  useEffect(() => {
    if (!exportOpen) return
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest('.engine-export')) return
      setExportOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [exportOpen])

  useEffect(() => {
    const host = popup ? popupHostRef.current : hostRef.current
    if (!host || !ready) return
    const surface = host.querySelector('video') || host

    const sendTouch = (cmd: Record<string, unknown>) => {
      const rtc = rtcRef.current
      if (!rtc) return
      void sendModelingCmd(rtc, cmd).catch(() => {})
    }

    const endDrag = () => {
      const g = touchGestureRef.current
      if (!g) return
      sendTouch({
        type: 'camera_drag_end',
        interaction: g.interaction,
        window: g.lastCenter,
      })
      touchGestureRef.current = null
    }

    const startDrag = (
      type: 'rotate' | 'pan',
      center: { x: number; y: number },
      distance: number,
    ) => {
      endDrag()
      const interaction = type === 'rotate' ? 'rotatetrackball' : 'pan'
      touchGestureRef.current = { type, interaction, lastCenter: center, lastDistance: distance }
      sendTouch({ type: 'camera_drag_start', interaction, window: center })
    }

    const updateGesture = () => {
      const points = Array.from(touchPointsRef.current.values())
      if (!points.length) {
        endDrag()
        return
      }
      const nextType = points.length === 1 ? 'rotate' : 'pan'
      const center = {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      }
      const distance =
        points.length < 2
          ? 0
          : Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y)
      const g = touchGestureRef.current
      if (!g || g.type !== nextType) {
        startDrag(nextType, center, distance)
        return
      }
      sendTouch({
        type: 'camera_drag_move',
        interaction: g.interaction,
        window: center,
      })
      if (nextType === 'pan' && distance > 0 && g.lastDistance > 0) {
        const delta = distance - g.lastDistance
        if (Math.abs(delta) >= 1) {
          sendTouch({
            type: 'default_camera_zoom',
            magnitude: delta * window.devicePixelRatio * 2.5,
          })
        }
      }
      g.lastCenter = center
      g.lastDistance = distance
    }

    const pointFrom = (touch: Touch) => {
      const rect = surface.getBoundingClientRect()
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
    }

    const onStart = (e: TouchEvent) => {
      e.preventDefault()
      for (const touch of Array.from(e.changedTouches)) {
        touchPointsRef.current.set(touch.identifier, pointFrom(touch))
      }
      updateGesture()
    }
    const onMove = (e: TouchEvent) => {
      if (!touchPointsRef.current.size) return
      e.preventDefault()
      for (const touch of Array.from(e.changedTouches)) {
        if (touchPointsRef.current.has(touch.identifier)) {
          touchPointsRef.current.set(touch.identifier, pointFrom(touch))
        }
      }
      updateGesture()
    }
    const onEnd = (e: TouchEvent) => {
      if (!touchPointsRef.current.size) return
      for (const touch of Array.from(e.changedTouches)) {
        touchPointsRef.current.delete(touch.identifier)
      }
      updateGesture()
    }

    const onWheel = (e: WheelEvent) => {
      if (!rtcRef.current) return
      e.preventDefault()
      const magnitude = -e.deltaY * 0.35
      if (!magnitude) return
      void sendModelingCmd(rtcRef.current, {
        type: 'default_camera_zoom',
        magnitude,
      }).catch(() => {})
    }

    // Desktop drag: Pan / Rotate tools, or middle/right-button pan.
    let mouseDrag: {
      interaction: 'rotatetrackball' | 'pan'
      last: { x: number; y: number }
    } | null = null

    const pointFromMouse = (ev: MouseEvent) => {
      const rect = surface.getBoundingClientRect()
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
      const wantsPan = panModeRef.current || e.button === 1 || e.button === 2
      const wantsRotate = rotateModeRef.current && e.button === 0 && !wantsPan
      if (e.button === 0 && !wantsPan && !wantsRotate) return // left-click select
      e.preventDefault()
      const pt = pointFromMouse(e)
      const interaction = wantsPan ? 'pan' : 'rotatetrackball'
      mouseDrag = { interaction, last: pt }
      sendTouch({ type: 'camera_drag_start', interaction, window: pt })
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDrag) return
      e.preventDefault()
      const pt = pointFromMouse(e)
      sendTouch({
        type: 'camera_drag_move',
        interaction: mouseDrag.interaction,
        window: pt,
      })
      mouseDrag.last = pt
    }
    const onMouseUp = (e: MouseEvent) => {
      if (!mouseDrag) return
      const pt = pointFromMouse(e)
      sendTouch({
        type: 'camera_drag_end',
        interaction: mouseDrag.interaction,
        window: pt,
      })
      mouseDrag = null
    }

    const onContextMenu = (e: Event) => e.preventDefault()

    const onStartL = onStart as EventListener
    const onMoveL = onMove as EventListener
    const onEndL = onEnd as EventListener
    const onWheelL = onWheel as EventListener
    const onMouseDownL = onMouseDown as EventListener

    surface.addEventListener('touchstart', onStartL, { passive: false })
    surface.addEventListener('touchmove', onMoveL, { passive: false })
    surface.addEventListener('touchend', onEndL, { passive: false })
    surface.addEventListener('touchcancel', onEndL, { passive: false })
    surface.addEventListener('wheel', onWheelL, { passive: false })
    surface.addEventListener('mousedown', onMouseDownL)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    surface.addEventListener('contextmenu', onContextMenu)
    return () => {
      surface.removeEventListener('touchstart', onStartL)
      surface.removeEventListener('touchmove', onMoveL)
      surface.removeEventListener('touchend', onEndL)
      surface.removeEventListener('touchcancel', onEndL)
      surface.removeEventListener('wheel', onWheelL)
      surface.removeEventListener('mousedown', onMouseDownL)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      surface.removeEventListener('contextmenu', onContextMenu)
      endDrag()
      touchPointsRef.current.clear()
    }
  }, [ready, popup])

  useEffect(() => {
    panModeRef.current = panMode
  }, [panMode])

  useEffect(() => {
    rotateModeRef.current = rotateMode
  }, [rotateMode])

  function onPointerDown(e: ReactPointerEvent) {
    if (e.pointerType === 'touch' || e.button !== 0) return
    if (panModeRef.current || rotateModeRef.current) return
    const host = (e.currentTarget as HTMLElement).querySelector('.engine-host')
    const surface = host?.querySelector('video') || host
    if (!surface) return
    const rect = surface.getBoundingClientRect()
    pointerDownRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerUp(e: ReactPointerEvent) {
    const down = pointerDownRef.current
    pointerDownRef.current = null
    if (panModeRef.current || rotateModeRef.current) return
    if (e.pointerType === 'touch' || e.button !== 0 || !down || !ready) return
    const host = (e.currentTarget as HTMLElement).querySelector('.engine-host')
    const surface =
      (host?.querySelector('video') as HTMLVideoElement | null) ||
      (host as HTMLElement | null)
    if (!surface) return
    const rect = surface.getBoundingClientRect()
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    if (Math.hypot(point.x - down.x, point.y - down.y) > 4) return
    const fbW =
      surface instanceof HTMLVideoElement
        ? surface.videoWidth || surface.clientWidth
        : surface.clientWidth
    const fbH =
      surface instanceof HTMLVideoElement
        ? surface.videoHeight || surface.clientHeight
        : surface.clientHeight
    const scaleX = rect.width > 0 && fbW > 0 ? fbW / rect.width : 1
    const scaleY = rect.height > 0 && fbH > 0 ? fbH / rect.height : 1
    void withRtc('Selecting…', async (rtc) => {
      await sendModelingCmd(rtc, {
        type: 'set_selection_filter',
        filter: ['solid3d', 'face', 'edge'],
      })
      const res = await sendModelingCmd(rtc, {
        type: 'select_with_point',
        selected_at_window: {
          x: Math.round(point.x * scaleX),
          y: Math.round(point.y * scaleY),
        },
        selection_type: 'replace',
      })
      setSelectionInfo(selectionSummary(res))
      try {
        await sendModelingCmd(rtc, {
          type: 'default_camera_center_to_selection',
          camera_movement: 'none',
        })
      } catch {
        /* optional */
      }
    })
  }

  if (!active) {
    let idleMessage: ReactNode
    if (!hasKcl && jobStatus === 'failed') {
      idleMessage = (
        <>
          This job failed before producing <code>main.kcl</code>. Retry the job or refine
          from Workbench/Iterate once KCL exists.
        </>
      )
    } else if (!hasKcl) {
      idleMessage = (
        <>
          Waiting for <code>main.kcl</code> — Live engine needs a completed reconstruction
          export.
        </>
      )
    } else {
      idleMessage = (
        <>
          Turn on <strong>Live engine</strong> for a Zoo WebRTC preview of{' '}
          <code>main.kcl</code> (uses API minutes). Open the large viewer for the full
          toolset.
        </>
      )
    }
    return (
      <div className="engine-shell idle panel-block">
        <p className="muted">{idleMessage}</p>
      </div>
    )
  }

  const sceneDisabled = !connected || !ready

  function renderToolbar(mode: ToolbarMode) {
    const full = mode === 'full'
    return (
      <div className={`engine-toolbar${full ? ' full' : ' compact'}`}>
        <div className="engine-controls" role="toolbar" aria-label="Session">
          {!connected ? (
            <IconBtn
              label="Start"
              primary
              onClick={() => setConnected(true)}
            >
              <IconPlay />
            </IconBtn>
          ) : (
            <IconBtn
              label="Stop"
              onClick={() => {
                setConnected(false)
                setReady(false)
                setStatus('Disconnected')
              }}
            >
              <IconStop />
            </IconBtn>
          )}
          <IconBtn
            label={connected ? 'Run' : 'Start + run'}
            disabled={!draft.trim() || runBusy || (connected && !ready)}
            onClick={() => onRunDraft()}
          >
            <IconRefresh />
          </IconBtn>
          {!full ? (
            <IconBtn label="Expand" disabled={!kcl} onClick={() => setPopup(true)}>
              <IconExpand />
            </IconBtn>
          ) : null}
          <IconBtn
            label="Fit"
            disabled={sceneDisabled}
            onClick={() => void withRtc('Fitting…', zoomToFit)}
          >
            <IconFit />
          </IconBtn>
          <IconBtn
            label="Zoom in"
            disabled={sceneDisabled}
            onClick={() => void withRtc('Zoom in', (rtc) => cameraZoom(rtc, 48))}
          >
            <IconZoomIn />
          </IconBtn>
          <IconBtn
            label="Zoom out"
            disabled={sceneDisabled}
            onClick={() => void withRtc('Zoom out', (rtc) => cameraZoom(rtc, -48))}
          >
            <IconZoomOut />
          </IconBtn>
          <IconBtn
            label="Pan"
            active={panMode}
            disabled={sceneDisabled}
            onClick={() => {
              setPanMode((v) => !v)
              setRotateMode(false)
            }}
          >
            <IconPan />
          </IconBtn>
          <IconBtn
            label="Rotate"
            active={rotateMode}
            disabled={sceneDisabled}
            onClick={() => {
              setRotateMode((v) => !v)
              setPanMode(false)
            }}
          >
            <IconRotate />
          </IconBtn>
          <IconBtn
            label="Scale up"
            disabled={sceneDisabled}
            onClick={() => void withRtc('Scale up', (rtc) => scaleObjects(rtc, 1.15))}
          >
            <IconScaleUp />
          </IconBtn>
          <IconBtn
            label="Scale down"
            disabled={sceneDisabled}
            onClick={() => void withRtc('Scale down', (rtc) => scaleObjects(rtc, 1 / 1.15))}
          >
            <IconScaleDown />
          </IconBtn>
          <IconBtn
            label="Edges"
            active={edgesOn}
            disabled={sceneDisabled}
            onClick={() => {
              const next = !edgesOn
              setEdgesOn(next)
              void withRtc(next ? 'Edges on' : 'Edges off', (rtc) => applyEdges(rtc, next))
            }}
          >
            <IconEdges />
          </IconBtn>
          <IconBtn
            label="X-ray"
            active={xrayOn}
            disabled={sceneDisabled}
            onClick={() => {
              const next = !xrayOn
              setXrayOn(next)
              void withRtc(next ? 'X-ray on' : 'X-ray off', async (rtc) => {
                if (next) {
                  await applyXray(rtc, true, xrayOpacity)
                } else if (kcl) {
                  await applyAppearanceFromKcl(rtc, kcl)
                } else {
                  await applyXray(rtc, false, xrayOpacity)
                }
              })
            }}
          >
            <IconXray />
          </IconBtn>
          <div className="engine-export">
            <IconBtn
              label={exportBusy ? 'Exporting…' : 'Export'}
              disabled={sceneDisabled || exportBusy}
              onClick={() => setExportOpen((v) => !v)}
            >
              <IconExport />
            </IconBtn>
            {exportOpen ? (
              <div className="engine-export-menu" role="menu">
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void withRtc(`Export ${f.label}`, (rtc) => exportFormat(rtc, f.key))
                    }
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {full ? (
          <>
            <div className="engine-controls" role="toolbar" aria-label="Pan nudges">
              <span className="engine-chip-label">Pan</span>
              {(
                [
                  ['↖', -40, -40],
                  ['↑', 0, -56],
                  ['↗', 40, -40],
                  ['←', -56, 0],
                  ['·', 0, 0],
                  ['→', 56, 0],
                  ['↙', -40, 40],
                  ['↓', 0, 56],
                  ['↘', 40, 40],
                ] as const
              ).map(([label, dx, dy]) => (
                <button
                  key={`pan-${label}`}
                  type="button"
                  className="engine-chip"
                  disabled={sceneDisabled || (dx === 0 && dy === 0)}
                  title={dx === 0 && dy === 0 ? 'Pan pad' : `Pan ${label}`}
                  onClick={() => {
                    if (dx === 0 && dy === 0) return
                    void withRtc(`Pan ${label}`, (rtc) => cameraPanNudge(rtc, dx, dy))
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="engine-controls" role="toolbar" aria-label="Rotate nudges">
              <span className="engine-chip-label">Rotate</span>
              {(
                [
                  ['↖', -48, -48],
                  ['↑', 0, -64],
                  ['↗', 48, -48],
                  ['←', -64, 0],
                  ['↺', -72, 0],
                  ['→', 64, 0],
                  ['↙', -48, 48],
                  ['↓', 0, 64],
                  ['↘', 48, 48],
                ] as const
              ).map(([label, dx, dy]) => (
                <button
                  key={`rot-${label}`}
                  type="button"
                  className="engine-chip"
                  disabled={sceneDisabled}
                  title={`Rotate ${label}`}
                  onClick={() =>
                    void withRtc(`Rotate ${label}`, (rtc) => cameraRotateNudge(rtc, dx, dy))
                  }
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="engine-chip"
                disabled={sceneDisabled || Math.abs(objectScale - 1) < 0.01}
                title="Reset object scale"
                onClick={() => void withRtc('Reset scale', resetObjectScale)}
              >
                Scale {objectScale.toFixed(2)}×
              </button>
            </div>
            <div className="engine-controls" role="toolbar" aria-label="Advanced scene">
              {CAMERA_VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className="engine-chip"
                  disabled={sceneDisabled}
                  onClick={() =>
                    void withRtc(`View ${v.label}`, (rtc) => setCameraView(rtc, v.key))
                  }
                >
                  {v.label}
                </button>
              ))}
              {xrayOn ? (
                <label className="engine-slider">
                  Opacity
                  <input
                    type="range"
                    min={0.05}
                    max={0.9}
                    step={0.05}
                    value={xrayOpacity}
                    disabled={sceneDisabled}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setXrayOpacity(v)
                      void withRtc('X-ray opacity', (rtc) => applyXray(rtc, true, v))
                    }}
                  />
                </label>
              ) : null}
              <IconBtn
                label="Capture"
                disabled={sceneDisabled}
                onClick={() => void withRtc('Capturing PNG…', capturePng)}
              >
                <IconCamera />
              </IconBtn>
              <IconBtn
                label={snapBusy ? 'Snaps…' : 'Resnap'}
                disabled={sceneDisabled || snapBusy}
                onClick={() => void withRtc('Refreshing snapshots…', refreshSnapshotRail)}
              >
                <IconRefresh />
              </IconBtn>
              <IconBtn
                label="Copy KCL"
                disabled={!draft.trim()}
                onClick={() => {
                  void navigator.clipboard.writeText(draft).then(
                    () => appLog('Copied KCL draft to clipboard'),
                    () => setError('Could not copy KCL'),
                  )
                  onCopyKcl?.()
                }}
              >
                <IconCopy />
              </IconBtn>
              <IconBtn label="KCL file" disabled={!kcl} onClick={() => onDownloadKcl?.()}>
                <IconCode />
              </IconBtn>
            </div>

            <div className="engine-controls" role="toolbar" aria-label="Explode">
              <IconExplode />
              {(
                [
                  [null, 'Assemble'],
                  ['horizontal', 'H'],
                  ['vertical', 'V'],
                  ['radial', 'R'],
                  ['grid', 'G'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={label}
                  type="button"
                  className={`engine-chip${explodeMode === mode ? ' active' : ''}`}
                  disabled={sceneDisabled}
                  onClick={() => {
                    setExplodeMode(mode)
                    void withRtc(`Explode ${label}`, (rtc) =>
                      applyExplode(rtc, mode, explodeSpacing),
                    )
                  }}
                >
                  {label}
                </button>
              ))}
              {explodeMode ? (
                <label className="engine-slider">
                  Gap
                  <input
                    type="range"
                    min={2}
                    max={40}
                    step={1}
                    value={explodeSpacing}
                    disabled={sceneDisabled}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setExplodeSpacing(v)
                      void withRtc('Explode spacing', (rtc) =>
                        applyExplode(rtc, explodeMode, v),
                      )
                    }}
                  />
                </label>
              ) : null}
            </div>

            <div className="engine-controls" role="toolbar" aria-label="Inspect">
              <IconBtn
                label="Values"
                active={inspector === 'values'}
                onClick={() => setInspector((v) => (v === 'values' ? 'none' : 'values'))}
              >
                <IconValues />
              </IconBtn>
              <IconBtn
                label={execErrors.length ? `Errors (${execErrors.length})` : 'Errors'}
                active={inspector === 'errors'}
                onClick={() => setInspector((v) => (v === 'errors' ? 'none' : 'errors'))}
              >
                <IconErrors />
              </IconBtn>
            </div>
          </>
        ) : null}
      </div>
    )
  }

  const snapRail = (
    <div className="engine-snap-rail" aria-label="Camera views">
      {CAMERA_VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          className="engine-snap-card"
          disabled={sceneDisabled}
          onClick={() => void withRtc(`View ${v.label}`, (rtc) => setCameraView(rtc, v.key))}
          title={`Jump to ${v.label} view`}
        >
          <span>{v.label}</span>
          {snapUrls[v.key] ? (
            <img src={snapUrls[v.key]} alt="" />
          ) : (
            <span className="engine-snap-empty">{snapBusy ? '…' : '—'}</span>
          )}
        </button>
      ))}
    </div>
  )

  const inspectorPanel =
    inspector === 'values' ? (
      <div className="engine-inspector">
        <p className="engine-inspector-lead">
          <strong>Values</strong> — top-level numbers/strings KCL returned after the last
          successful execute (useful for checking dimensions). Empty if the program doesn’t
          expose variables.
        </p>
        <pre>
          {execValues != null
            ? JSON.stringify(execValues, null, 2)
            : '(no values yet)'}
        </pre>
      </div>
    ) : inspector === 'errors' ? (
      <div className="engine-inspector">
        <p className="engine-inspector-lead">
          <strong>Errors</strong> — KCL compile/runtime messages from the last run. Fix the
          source in the editor, then Run.
        </p>
        {execErrors.length ? (
          <ul>
            {execErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">No errors from the last run.</p>
        )}
      </div>
    ) : null

  return (
    <div
      className="engine-shell panel-block is-active"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div className="engine-meta">
        <span className="engine-status">{status}</span>
        <span className="hint">
          {panMode
            ? 'Pan mode · drag to move'
            : rotateMode
              ? 'Rotate mode · drag to orbit'
              : 'Scroll zoom · Pan/Rotate tools · right-drag pan'}
          {' · '}edit KCL below · Run without reconnect · Save to disk
        </span>
      </div>
      <UsageMeter
        jobSeconds={jobSeconds}
        sessionSeconds={connected ? sessionSeconds : 0}
        refreshKey={`${connected}-${ready}`}
        compact
      />
      {renderToolbar('compact')}
      {busyNote ? <p className="hint engine-busy">{busyNote}</p> : null}
      {error ? <div className="banner bad">{error}</div> : null}
      {snapRail}
      <div className="engine-split">
        <div className="engine-viewport-col">
          <div className="engine-host" ref={hostRef} />
          {!connected ? (
            <p className="muted engine-idle-note">
              Session is off so you are not burning Engine minutes. Edit KCL below, then Start
              or Run.
            </p>
          ) : null}
        </div>
        <div className="engine-editor-col">
          <div className="engine-editor-head">
            <button
              type="button"
              className={`section-toggle${editorOpen ? ' open' : ''}`}
              aria-expanded={editorOpen}
              aria-controls="engine-kcl-editor"
              onClick={() => setEditorOpen((v) => !v)}
            >
              <span className="section-toggle-label">
                <span className="section-toggle-chevron" aria-hidden="true">
                  {editorOpen ? '▾' : '▸'}
                </span>
                <span className="section-toggle-title" role="heading" aria-level={3}>
                  KCL editor
                </span>
              </span>
              <span className="section-toggle-meta">
                {dirty ? 'Unsaved changes' : editorOpen ? 'Saved' : 'Show'}
              </span>
            </button>
          </div>
          <div id="engine-kcl-editor" hidden={!editorOpen}>
            <div className="engine-editor-actions">
              <button
                type="button"
                className="primary"
                disabled={!draft.trim() || runBusy || (connected && !ready)}
                onClick={() => onRunDraft()}
              >
                {runBusy ? 'Running…' : connected ? 'Run' : 'Start + run'}
              </button>
              <button
                type="button"
                disabled={!dirty || saveBusy || !draft.trim()}
                onClick={() => void onSaveDraft()}
              >
                {saveBusy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" disabled={!dirty || saveBusy} onClick={onDiscardDraft}>
                Discard
              </button>
              <button
                type="button"
                disabled={!draft.trim() || formatBusy}
                onClick={() => void onFormatDraft()}
                title="Pretty-print with Zoo KCL recast (requires valid parse)"
              >
                {formatBusy ? 'Formatting…' : 'Format'}
              </button>
              <button
                type="button"
                className="linkish"
                disabled={!draft.trim()}
                onClick={() => {
                  const blob = new Blob([draft], { type: 'text/plain;charset=utf-8' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'main.kcl'
                  a.click()
                  URL.revokeObjectURL(url)
                  appLog('Downloaded KCL draft')
                  onDownloadKcl?.()
                }}
              >
                Download
              </button>
              <label className="engine-reexport-toggle">
                <input
                  type="checkbox"
                  checked={reexportOnSave}
                  onChange={(e) => setReexportOnSave(e.target.checked)}
                  disabled={saveBusy}
                />
                Also re-export meshes (Compare)
              </label>
            </div>
            <p className="hint engine-editor-hint">
              Run executes the draft in the live session (no reconnect). The editor uses Zoo’s
              KCL WASM for parse/lint squiggles and Format (recast). Save writes{' '}
              <code>main.kcl</code>, archives under <code>kcl_history/</code>, and optionally
              re-exports STL/STEP/3MF for Compare. Restore older versions from Iterate.
            </p>
            <KclEditor value={draft} onChange={setDraft} ariaLabel="main.kcl editor" />
          </div>
        </div>
      </div>

      {popup && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="engine-popup"
              role="dialog"
              aria-modal="true"
              aria-label="Large Live engine viewer"
              onClick={(e) => {
                if (e.target === e.currentTarget) setPopup(false)
              }}
            >
              <div
                className="engine-popup-inner"
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
              >
                <div className="engine-popup-head">
                  <h3>Live engine</h3>
                  <div className="engine-popup-actions">
                    <span className="engine-status">{status}</span>
                    <button type="button" onClick={() => setPopup(false)}>
                      Close
                    </button>
                  </div>
                </div>
                <UsageMeter
                  jobSeconds={jobSeconds}
                  sessionSeconds={connected ? sessionSeconds : 0}
                  refreshKey={`popup-${connected}-${ready}`}
                  compact
                />
                {renderToolbar('full')}
                {busyNote ? <p className="hint engine-busy">{busyNote}</p> : null}
                {selectionInfo ? (
                  <p className="engine-selection muted">
                    Selection: <code>{selectionInfo}</code>
                  </p>
                ) : null}
                {error ? <div className="banner bad">{error}</div> : null}
                {snapRail}
                <div className="engine-host large" ref={popupHostRef} />
                {inspectorPanel}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
