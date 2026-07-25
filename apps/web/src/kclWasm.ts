/**
 * Thin browser/Node wrapper around @kittycad/kcl-wasm-lib for parse, lint, and format.
 * WASM is already served from /kcl_wasm_lib_bg.wasm (npm postinstall copy).
 */
import init, {
  kcl_lint,
  parse_wasm,
  recast_wasm,
} from '@kittycad/kcl-wasm-lib'

export type KclIssue = {
  from: number
  to: number
  severity: 'error' | 'warning' | 'info'
  message: string
}

type WasmDiagnostic = {
  sourceRange?: [number, number, number] | number[]
  message?: string
  severity?: string
  suggestion?: string | null
}

let initPromise: Promise<void> | null = null

function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process
  return Boolean(proc?.versions?.node)
}

async function loadWasmBytes(): Promise<BufferSource | string> {
  // Vitest/jsdom has `window` but still runs on Node — prefer filesystem bytes there.
  if (isNodeRuntime()) {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const cwd = process.cwd()
    // Prefer workspace package paths before hoisted root copies (version can differ).
    const candidates = [
      path.join(cwd, 'node_modules/@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm'),
      path.join(cwd, 'public/kcl_wasm_lib_bg.wasm'),
      path.join(cwd, '../node_modules/@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm'),
      path.join(cwd, '../../node_modules/@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm'),
    ]
    const found = candidates.find((p) => fs.existsSync(p))
    if (!found) throw new Error('kcl_wasm_lib_bg.wasm not found')
    return fs.readFileSync(found)
  }
  // Served by postinstall copy-wasm; must match @kittycad/kcl-wasm-lib JS version.
  return '/kcl_wasm_lib_bg.wasm'
}

export function ensureKclWasm(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const module_or_path = await loadWasmBytes()
      await init({ module_or_path })
    })().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise
}

function mapSeverity(raw: string | undefined): KclIssue['severity'] {
  const s = (raw || '').toLowerCase()
  if (s === 'warning' || s === 'warn') return 'warning'
  if (s === 'hint' || s === 'info') return 'info'
  return 'error'
}

function issueFromWasm(d: WasmDiagnostic, docLen: number): KclIssue | null {
  const msg = (d.message || '').trim()
  if (!msg) return null
  const range = d.sourceRange
  let from = 0
  let to = 0
  if (Array.isArray(range) && range.length >= 2) {
    from = Math.max(0, Math.min(docLen, Number(range[0]) || 0))
    to = Math.max(from, Math.min(docLen, Number(range[1]) || from))
  }
  if (to === from && docLen > 0) {
    to = Math.min(docLen, from + 1)
  }
  const suggestion = (d.suggestion || '').trim()
  return {
    from,
    to,
    severity: mapSeverity(d.severity),
    message: suggestion ? `${msg} — ${suggestion}` : msg,
  }
}

function asDiagList(value: unknown): WasmDiagnostic[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is WasmDiagnostic => Boolean(item) && typeof item === 'object')
}

/** Parse + lint. Parse failures become errors; lint runs only when parse succeeds. */
export async function analyzeKcl(source: string): Promise<KclIssue[]> {
  await ensureKclWasm()
  const text = source.replace(/\r\n/g, '\n')
  const docLen = text.length
  const parsed = parse_wasm(text) as [unknown, unknown]
  const program = Array.isArray(parsed) ? parsed[0] : null
  const parseErrs = asDiagList(Array.isArray(parsed) ? parsed[1] : [])
  const issues = parseErrs
    .map((d) => issueFromWasm(d, docLen))
    .filter((x): x is KclIssue => Boolean(x))
  if (!program || issues.some((i) => i.severity === 'error')) {
    return issues
  }
  try {
    const lintRaw = await kcl_lint(JSON.stringify(program))
    for (const d of asDiagList(lintRaw)) {
      const issue = issueFromWasm(d, docLen)
      if (issue) issues.push(issue)
    }
  } catch {
    // Lint is best-effort; parse issues already surface.
  }
  return issues
}

/** Pretty-print via recast. Throws if the source does not parse. */
export async function formatKcl(source: string): Promise<string> {
  await ensureKclWasm()
  const text = source.replace(/\r\n/g, '\n')
  if (!text.trim()) return text
  const parsed = parse_wasm(text) as [unknown, unknown]
  const program = Array.isArray(parsed) ? parsed[0] : null
  const parseErrs = asDiagList(Array.isArray(parsed) ? parsed[1] : [])
  if (!program) {
    const first = parseErrs[0]?.message || 'KCL did not parse'
    throw new Error(first)
  }
  const out = recast_wasm(JSON.stringify(program))
  if (typeof out !== 'string') {
    throw new Error('Formatter returned no source')
  }
  return out.endsWith('\n') ? out : `${out}\n`
}
