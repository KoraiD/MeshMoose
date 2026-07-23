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
  const token = getApiToken()
  const url = `${BASE}/jobs/${jobId}/events`
  const controller = new AbortController()

  void (async () => {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(await errDetail(res))
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          try {
            onEvent(JSON.parse(line.slice(6)) as JobEvent)
          } catch {
            /* ignore malformed */
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      onError?.(e as Error)
    }
  })()

  return () => controller.abort()
}
