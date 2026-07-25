/** Lightweight syntax helpers for Workbench panels (no heavy highlighter deps). */

export const KCL_KEYWORDS = new Set([
  'fn',
  'return',
  'const',
  'let',
  'if',
  'else',
  'for',
  'in',
  'import',
  'export',
  'as',
  'true',
  'false',
  'null',
])

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function highlightKcl(source: string): string {
  if (!source) return ''
  const parts: string[] = []
  const re =
    /(\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w]*\b|[^\s\w"'/]+|\s+)/g
  for (const raw of source.match(re) || [source]) {
    const tok = raw
    if (tok.startsWith('//')) {
      parts.push(`<span class="tok-comment">${esc(tok)}</span>`)
    } else if (
      (tok.startsWith('"') && tok.endsWith('"')) ||
      (tok.startsWith("'") && tok.endsWith("'"))
    ) {
      parts.push(`<span class="tok-string">${esc(tok)}</span>`)
    } else if (/^\d/.test(tok)) {
      parts.push(`<span class="tok-number">${esc(tok)}</span>`)
    } else if (KCL_KEYWORDS.has(tok)) {
      parts.push(`<span class="tok-kw">${esc(tok)}</span>`)
    } else if (/^[A-Za-z_]/.test(tok)) {
      parts.push(`<span class="tok-ident">${esc(tok)}</span>`)
    } else if (/^[{}()[\],.:;=+\-*/%<>!&|]+$/.test(tok)) {
      parts.push(`<span class="tok-punct">${esc(tok)}</span>`)
    } else {
      parts.push(esc(tok))
    }
  }
  return parts.join('')
}

export function highlightJson(source: string): string {
  if (!source) return ''
  try {
    const pretty = JSON.stringify(JSON.parse(source), null, 2)
    return pretty.replace(
      /("(?:\\.|[^"\\])*")\s*:|"((?:\\.|[^"\\])*)"|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])/g,
      (match, key, str, lit, num, punct) => {
        if (key) return `<span class="tok-key">${esc(key)}</span>:`
        if (str !== undefined) return `<span class="tok-string">"${esc(str)}"</span>`
        if (lit) return `<span class="tok-lit">${lit}</span>`
        if (num) return `<span class="tok-number">${num}</span>`
        if (punct) return `<span class="tok-punct">${punct}</span>`
        return esc(match)
      },
    )
  } catch {
    return esc(source)
  }
}

export function flattenMetrics(
  data: Record<string, unknown>,
  prefix = '',
): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = []
  for (const [k, v] of Object.entries(data)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      rows.push(...flattenMetrics(v as Record<string, unknown>, key))
    } else if (Array.isArray(v)) {
      rows.push({ key, value: JSON.stringify(v) })
    } else if (v == null) {
      rows.push({ key, value: 'null' })
    } else {
      rows.push({ key, value: String(v) })
    }
  }
  return rows
}
