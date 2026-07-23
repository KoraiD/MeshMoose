/** RTC modeling helpers inspired by KittyCAD/viewer (ZooWebView + modeling_cmd_req). */

export type ExportFormat = 'step' | 'stl' | 'obj' | 'ply' | 'gltf' | 'glb' | 'fbx'
export type CameraViewKey = 'top' | 'profile' | 'front' | 'isometric'
export type ExplodeMode = 'horizontal' | 'vertical' | 'radial' | 'grid'

export type RtcSender = {
  send: (data: string) => Promise<unknown>
}

export type ModelingResponse = {
  success?: boolean
  request_id?: string
  errors?: Array<{ message?: string; error_code?: string }>
  resp?: {
    type?: string
    data?: {
      files?: unknown[]
      modeling_response?: {
        type?: string
        data?: Record<string, unknown>
      }
    }
  }
}

export const EXPORT_FORMATS: { key: ExportFormat; label: string }[] = [
  { key: 'step', label: 'STEP' },
  { key: 'stl', label: 'STL' },
  { key: 'obj', label: 'OBJ' },
  { key: 'ply', label: 'PLY' },
  { key: 'glb', label: 'GLB' },
  { key: 'gltf', label: 'glTF' },
  { key: 'fbx', label: 'FBX' },
]

export const CAMERA_VIEWS: {
  key: CameraViewKey
  label: string
  vantage: { x: number; y: number; z: number }
  up: { x: number; y: number; z: number }
}[] = [
  {
    key: 'top',
    label: 'Top',
    vantage: { x: 0, y: 0, z: 128 },
    up: { x: 0, y: 1, z: 0 },
  },
  {
    key: 'profile',
    label: 'Profile',
    vantage: { x: 128, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
  },
  {
    key: 'front',
    label: 'Front',
    vantage: { x: 0, y: -128, z: 0 },
    up: { x: 0, y: 0, z: 1 },
  },
  {
    key: 'isometric',
    label: 'Iso',
    vantage: { x: 96, y: -96, z: 96 },
    up: { x: 0, y: 0, z: 1 },
  },
]

const DEFAULT_EXPORT_COORDS = {
  forward: { axis: 'y', direction: 'negative' },
  up: { axis: 'z', direction: 'positive' },
}

export function nextCmdId(): string {
  return crypto.randomUUID()
}

export function parseRtcResponse(raw: unknown): ModelingResponse {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as ModelingResponse
    } catch {
      return { success: false }
    }
  }
  if (raw && typeof raw === 'object') return raw as ModelingResponse
  return { success: false }
}

export async function sendModelingCmd(
  rtc: RtcSender,
  cmd: Record<string, unknown>,
): Promise<ModelingResponse> {
  const cmd_id = nextCmdId()
  const raw = await rtc.send(
    JSON.stringify({
      type: 'modeling_cmd_req',
      cmd_id,
      cmd,
    }),
  )
  return parseRtcResponse(raw)
}

export async function sendModelingBatch(
  rtc: RtcSender,
  cmds: Record<string, unknown>[],
): Promise<ModelingResponse> {
  const raw = await rtc.send(
    JSON.stringify({
      type: 'modeling_cmd_batch_req',
      batch_id: nextCmdId(),
      responses: true,
      requests: cmds.map((cmd) => ({
        cmd_id: nextCmdId(),
        cmd,
      })),
    }),
  )
  return parseRtcResponse(raw)
}

export function outputFormatForExport(format: ExportFormat): Record<string, unknown> {
  switch (format) {
    case 'glb':
      return { type: 'gltf', storage: 'binary', presentation: 'pretty' }
    case 'gltf':
      return { type: 'gltf', storage: 'embedded', presentation: 'pretty' }
    case 'fbx':
      return { type: 'fbx', storage: 'binary' }
    case 'obj':
      return { type: 'obj', coords: DEFAULT_EXPORT_COORDS, units: 'mm' }
    case 'ply':
      return {
        type: 'ply',
        coords: DEFAULT_EXPORT_COORDS,
        units: 'mm',
        storage: 'ascii',
        selection: { type: 'default_scene' },
      }
    case 'stl':
      return {
        type: 'stl',
        coords: DEFAULT_EXPORT_COORDS,
        units: 'mm',
        storage: 'ascii',
        selection: { type: 'default_scene' },
      }
    case 'step':
      return { type: 'step' }
    default: {
      const _exhaustive: never = format
      return _exhaustive
    }
  }
}

function uint8FromBase64(contents: string): Uint8Array {
  const binary = atob(contents)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function downloadExportFromResponse(response: ModelingResponse): string | null {
  const files =
    response.resp?.data?.files ?? response.resp?.data?.modeling_response?.data?.files
  if (!Array.isArray(files) || !files.length) return null
  let lastName: string | null = null
  for (const file of files) {
    if (!file || typeof file !== 'object') continue
    const record = file as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : 'export.bin'
    const contents = record.contents
    let bytes: Uint8Array | null = null
    if (typeof contents === 'string') bytes = uint8FromBase64(contents)
    else if (contents instanceof ArrayBuffer) bytes = new Uint8Array(contents)
    else if (ArrayBuffer.isView(contents)) {
      bytes = new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength)
    }
    if (!bytes) continue
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const blob = new Blob([copy])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    lastName = name
  }
  return lastName
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

/** Decode engine snapshot/export image bytes (base64 string, raw string, or byte array). */
export function contentsToDataUrl(
  contents: unknown,
  mime: 'image/png' | 'image/jpeg' = 'image/png',
): string | null {
  if (contents == null) return null

  if (typeof contents === 'string') {
    const normalized = contents.trim()
    if (!normalized) return null
    if (normalized.startsWith('data:image/')) return normalized
    const compact = normalized.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
    if (/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
      const remainder = compact.length % 4
      if (remainder !== 1) {
        const padded = `${compact}${remainder ? '='.repeat(4 - remainder) : ''}`
        try {
          const decoded = atob(padded)
          const reencoded = btoa(decoded).replace(/=+$/g, '')
          if (reencoded === padded.replace(/=+$/g, '')) {
            return `data:${mime};base64,${padded}`
          }
        } catch {
          /* fall through */
        }
        // Many Zoo payloads are already valid base64 even if round-trip checks flake.
        return `data:${mime};base64,${padded}`
      }
    }
    try {
      return `data:${mime};base64,${btoa(normalized)}`
    } catch {
      return null
    }
  }

  if (Array.isArray(contents) && contents.every((n) => typeof n === 'number')) {
    return `data:${mime};base64,${bytesToBase64(new Uint8Array(contents))}`
  }
  if (contents instanceof ArrayBuffer) {
    return `data:${mime};base64,${bytesToBase64(new Uint8Array(contents))}`
  }
  if (ArrayBuffer.isView(contents)) {
    const view = contents as ArrayBufferView
    return `data:${mime};base64,${bytesToBase64(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    )}`
  }
  return null
}

/** @deprecated use contentsToDataUrl */
export function snapshotDataUrl(contents?: string): string | null {
  return contentsToDataUrl(contents)
}

export function extractSnapshotDataUrl(response: ModelingResponse): string | null {
  if (response.success === false) return null
  const resp = response.resp
  if (!resp) return null

  if (resp.type === 'modeling') {
    const mr = resp.data?.modeling_response
    if (mr?.type === 'take_snapshot') {
      return contentsToDataUrl(mr.data?.contents)
    }
  }

  // Batch responses: pick the first take_snapshot outcome.
  if (resp.type === 'modeling_batch') {
    const responses = (resp.data as { responses?: Record<string, unknown> })?.responses
    if (responses && typeof responses === 'object') {
      for (const entry of Object.values(responses)) {
        if (!entry || typeof entry !== 'object') continue
        const rec = entry as Record<string, unknown>
        const modeling =
          (rec.response as { type?: string; data?: { contents?: unknown } } | undefined) ??
          (rec as { type?: string; data?: { contents?: unknown } })
        if (modeling?.type === 'take_snapshot') {
          const url = contentsToDataUrl(modeling.data?.contents)
          if (url) return url
        }
      }
    }
  }

  // Last resort: dig for a contents field.
  const dig = (node: unknown, depth = 0): string | null => {
    if (!node || depth > 8) return null
    if (typeof node === 'object') {
      const rec = node as Record<string, unknown>
      if ('contents' in rec) {
        const url = contentsToDataUrl(rec.contents)
        if (url) return url
      }
      for (const v of Object.values(rec)) {
        const found = dig(v, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return dig(resp)
}

export function modelingErrorMessage(response: ModelingResponse): string | null {
  if (response.success !== false) return null
  const first = response.errors?.[0]
  if (first?.message) return first.message
  return 'Engine command failed'
}

export async function waitFrame(ms = 140): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

export function entityIdsFromResponse(response: ModelingResponse): string[] {
  const data = response.resp?.data?.modeling_response
  if (data?.type !== 'scene_get_entity_ids') return []
  const ids = data.data?.entity_ids
  if (!Array.isArray(ids)) return []
  return ids.flat().filter((id): id is string => typeof id === 'string' && Boolean(id))
}

export function explodeOffsets(
  mode: ExplodeMode,
  objectIds: string[],
  spacing: number,
): Record<string, { x: number; y: number; z: number }> {
  const n = Math.max(objectIds.length, 1)
  const out: Record<string, { x: number; y: number; z: number }> = {}
  objectIds.forEach((id, index) => {
    const t = index - (n - 1) / 2
    switch (mode) {
      case 'horizontal':
        out[id] = { x: t * spacing, y: 0, z: 0 }
        break
      case 'vertical':
        out[id] = { x: 0, y: 0, z: t * spacing }
        break
      case 'radial': {
        const angle = (index / n) * Math.PI * 2
        out[id] = {
          x: Math.cos(angle) * spacing,
          y: Math.sin(angle) * spacing,
          z: 0,
        }
        break
      }
      case 'grid': {
        const cols = Math.ceil(Math.sqrt(n))
        const row = Math.floor(index / cols)
        const col = index % cols
        out[id] = {
          x: (col - (cols - 1) / 2) * spacing,
          y: (row - (cols - 1) / 2) * spacing,
          z: 0,
        }
        break
      }
      default: {
        const _exhaustive: never = mode
        return _exhaustive
      }
    }
  })
  return out
}

export function executorValuesFromResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return null
  const walk = (node: unknown, depth = 0): unknown => {
    if (!node || typeof node !== 'object' || depth > 6) return null
    const rec = node as Record<string, unknown>
    if ('values' in rec) return rec.values
    if ('variables' in rec) return rec.variables
    for (const key of ['data', 'resp', 'exec_state', 'outcome']) {
      if (key in rec) {
        const found = walk(rec[key], depth + 1)
        if (found != null) return found
      }
    }
    return null
  }
  return walk(result)
}

export function executorErrorsFromResult(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const out: string[] = []
  const visit = (node: unknown, depth = 0) => {
    if (!node || depth > 8) return
    if (typeof node === 'string') {
      if (node.trim()) out.push(node)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (typeof node === 'object') {
      const rec = node as Record<string, unknown>
      if (typeof rec.message === 'string') out.push(rec.message)
      if (Array.isArray(rec.errors)) visit(rec.errors, depth + 1)
      if (Array.isArray(rec.kcl_errors)) visit(rec.kcl_errors, depth + 1)
      for (const key of ['data', 'resp', 'error']) {
        if (key in rec) visit(rec[key], depth + 1)
      }
    }
  }
  visit(result)
  return [...new Set(out)].slice(0, 12)
}

export function selectionSummary(response: ModelingResponse): string | null {
  const data = response.resp?.data?.modeling_response
  if (!data || (data.type !== 'select_with_point' && data.type !== 'select_get')) {
    return null
  }
  try {
    const json = JSON.stringify(data.data)
    if (!json || json === '{}' || json === 'null') return 'Nothing selected'
    return json.length > 220 ? `${json.slice(0, 220)}…` : json
  } catch {
    return 'Selection updated'
  }
}
