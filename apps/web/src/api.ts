const KEY = 'meshmoose.zooApiToken'

export function getApiToken(): string {
  return localStorage.getItem(KEY) ?? ''
}

export function setApiToken(token: string): void {
  localStorage.setItem(KEY, token.trim())
}

export function clearApiToken(): void {
  localStorage.removeItem(KEY)
}

export function authHeaders(): HeadersInit {
  const token = getApiToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

const BASE = '/api'

export type PromptEntry = {
  role: 'initial' | 'refine' | string
  text: string
  mode?: string
  created_at: string
}

export type Job = {
  id: string
  title: string
  tags?: string[]
  prompt: string
  prompts?: PromptEntry[]
  mode: string
  status: string
  created_at: string
  updated_at: string
  /** Cumulative ms spent in running pipeline statuses. */
  active_ms?: number | null
  /** ISO start of the current running segment, if any. */
  run_started_at?: string | null
  conversation_id?: string | null
  error?: string | null
  input_photos?: string[]
  input_meshes?: string[]
  demo_id?: string | null
  notes?: string | null
  retry_of?: string | null
  retried_as?: string | null
}

export type Demo = {
  id: string
  title: string
  description?: string
  source_url?: string
  source_label?: string
  prompt: string
  mode?: string
  photos: string[]
  meshes: string[]
}

export type JobEvent = {
  ts?: string
  level?: string
  kind?: string
  message?: string
  status?: string
  error?: string | null
  path?: string
  name?: string
  mimetype?: string
}

export type Artifact = {
  name: string
  path: string
  kind: string
  bytes: number
  mtime: number
}

export type FinishPreset = {
  id: string
  name: string
  description: string
  color: string
  metalness: number
  roughness: number
  opacity?: number | null
}

async function errDetail(res: Response): Promise<string> {
  try {
    const data = await res.json()
    return typeof data.detail === 'string'
      ? data.detail
      : JSON.stringify(data.detail ?? data)
  } catch {
    return res.statusText
  }
}

export async function listJobs(): Promise<Job[]> {
  const res = await fetch(`${BASE}/jobs`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${id}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function listDemos(): Promise<Demo[]> {
  const res = await fetch(`${BASE}/demos`)
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function createJob(form: FormData): Promise<Job> {
  const res = await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function createJobFromDemo(
  demoId: string,
  mode: string,
  prompt?: string,
): Promise<Job> {
  const form = new FormData()
  form.set('mode', mode)
  if (prompt) form.set('prompt', prompt)
  const res = await fetch(`${BASE}/jobs/from-demo/${demoId}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function refineJob(
  id: string,
  message: string,
  options?: { photos?: FileList | File[] | null; meshes?: FileList | File[] | null },
): Promise<Job> {
  const form = new FormData()
  form.set('message', message)
  const photos = options?.photos
  const meshes = options?.meshes
  if (photos) {
    Array.from(photos).forEach((f) => form.append('photos', f))
  }
  if (meshes) {
    Array.from(meshes).forEach((f) => form.append('meshes', f))
  }
  const res = await fetch(`${BASE}/jobs/${id}/refine`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function listFinishes(): Promise<FinishPreset[]> {
  const res = await fetch(`${BASE}/finishes`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function applyFinish(id: string, preset: string): Promise<Job> {
  const form = new FormData()
  form.set('preset', preset)
  const res = await fetch(`${BASE}/jobs/${id}/finish`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function deleteJob(id: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await errDetail(res))
}

export async function cancelJob(id: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${id}/cancel`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function retryJob(id: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${id}/retry`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export type AlignResult = {
  /** 4×4 row-major matrix (nested rows) mapping generated → reference space. */
  transform: number[][]
  /**
   * Optional sparse sample indices into the generated mesh.
   * Omitted when distances are contiguous per-vertex (0..N-1).
   */
  vertex_indices?: number[] | null
  distances: number[]
  stats: {
    samples: number
    mean: number | null
    max: number | null
    p95: number | null
    rms: number | null
    icp_cost: number
  }
  units: string
}

export async function alignJob(id: string): Promise<AlignResult> {
  const res = await fetch(`${BASE}/jobs/${id}/align`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export type ReferenceInfo = {
  active: string
  available: string[]
}

export async function getReference(id: string): Promise<ReferenceInfo> {
  const res = await fetch(`${BASE}/jobs/${id}/reference`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function setReference(id: string, source: string): Promise<{ active: string }> {
  const res = await fetch(`${BASE}/jobs/${id}/reference`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function patchJob(
  id: string,
  body: { title?: string; tags?: string[] },
): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${id}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export type SaveKclResult = {
  job: Job
  kcl: string
  reexport?: boolean
}

export type KclVersion = {
  id: string
  created_at: string
  bytes: number
  chars: number
  note?: string | null
}

export async function saveJobKcl(
  id: string,
  kcl: string,
  opts?: { note?: string; reexport?: boolean },
): Promise<SaveKclResult> {
  const res = await fetch(`${BASE}/jobs/${id}/kcl`, {
    method: 'PUT',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      kcl,
      reexport: Boolean(opts?.reexport),
      ...(opts?.note ? { note: opts.note } : {}),
    }),
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export async function listKclVersions(id: string): Promise<KclVersion[]> {
  const res = await fetch(`${BASE}/jobs/${id}/kcl/versions`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await errDetail(res))
  const data = (await res.json()) as { versions?: KclVersion[] }
  return data.versions ?? []
}

export async function restoreKclVersion(
  id: string,
  versionId: string,
  opts?: { note?: string; reexport?: boolean },
): Promise<SaveKclResult> {
  const res = await fetch(`${BASE}/jobs/${id}/kcl/restore`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version_id: versionId,
      reexport: Boolean(opts?.reexport),
      ...(opts?.note ? { note: opts.note } : {}),
    }),
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export type ZooUsage = {
  balance: {
    monthly_api_credits_remaining?: number | null
    monthly_api_credits_remaining_monetary_value?: number | null
    stable_api_credits_remaining?: number | null
    stable_api_credits_remaining_monetary_value?: number | null
    monthly_included_credits?: number | null
    monthly_included_monetary_value?: number | null
    pay_as_you_go_credit_price?: number | null
    plan_name?: string | null
    updated_at?: string | null
  }
  recent_calls: Array<{
    id?: string
    endpoint?: string
    method?: string
    seconds?: number
    minutes?: number
    price?: number
    status_code?: number
    created_at?: string
  }>
  recent_totals: {
    count: number
    seconds: number
    price: number
  }
  pricing_note?: string
}

export async function getZooUsage(): Promise<ZooUsage> {
  const res = await fetch(`${BASE}/zoo/usage`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export function jobFileUrl(jobId: string, relative: string): string {
  return `${BASE}/jobs/${jobId}/files/${relative}`
}

/** Demo assets are served unauthenticated from the /demo-assets static mount. */
export function demoAssetUrl(demoId: string, filename: string): string {
  return `${BASE}/demo-assets/${encodeURIComponent(demoId)}/${encodeURIComponent(filename)}`
}

export async function listArtifacts(jobId: string): Promise<Artifact[]> {
  const res = await fetch(`${BASE}/jobs/${jobId}/artifacts`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await errDetail(res))
  return res.json()
}

export function subscribeJobEvents(
  jobId: string,
  onEvent: (ev: JobEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  let stopped = false
  let after = 0
  let controller: AbortController | null = null

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms)
    })

  void (async () => {
    let failures = 0
    while (!stopped) {
      // Read credentials per attempt so save/clear/rotate mid-session works.
      const token = getApiToken()
      if (!token) {
        failures = 0
        await sleep(1500)
        continue
      }

      controller = new AbortController()
      try {
        const url = `${BASE}/jobs/${jobId}/events?after=${after}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          throw new Error(await errDetail(res))
        }
        failures = 0
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!stopped) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() ?? ''
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            try {
              const ev = JSON.parse(line.slice(6)) as JobEvent
              after += 1
              onEvent(ev)
              if (ev.kind === 'stream_end' && ev.status === 'gone') {
                stopped = true
              }
            } catch {
              /* ignore malformed */
            }
          }
        }
        if (stopped) return
        // Stream ended (API reload, proxy idle timeout, etc.) — resume from cursor.
        await sleep(800)
      } catch (e) {
        if (stopped || (e as Error).name === 'AbortError') return
        failures += 1
        // Only surface persistent failures; brief disconnects reconnect silently.
        if (failures >= 3) {
          onError?.(e as Error)
          failures = 0
        }
        await sleep(Math.min(4000, 1000 * Math.max(1, failures)))
      }
    }
  })()

  return () => {
    stopped = true
    controller?.abort()
  }
}
