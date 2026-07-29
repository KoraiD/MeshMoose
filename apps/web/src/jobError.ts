/** Make Zoo/KCL job errors readable (strip ANSI, unwrap tuple reprs). */

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

function decodePyStringEscapes(body: string): string {
  return body
    .replace(/\\x1b/gi, '\u001b')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function unwrapTupleRepr(text: string): string {
  const s = text.trim()
  if (!(s.startsWith('(') && s.endsWith(')'))) return s
  // Match ('…', True) / ("…", True) with escaped quotes inside.
  const m = s.match(/^\(\s*(['"])([\s\S]*)\1\s*,\s*(?:True|False)\s*\)$/)
  if (!m) return s
  return decodePyStringEscapes(m[2])
}

export function formatJobError(raw: string | null | undefined): string {
  if (!raw) return ''
  let text = stripAnsi(raw)
  text = unwrapTupleRepr(text)
  text = stripAnsi(text)

  const lines = text
    .split(/\r?\n/)
    .map((ln) => ln.replace(/[╭╰─│·▲]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((ln) => {
      if (!ln) return false
      if (ln === 'main' || ln === 'True' || ln === 'False') return false
      if (/^\d+\s/.test(ln) && ln.includes('//')) return false
      return true
    })

  const title = lines.find((ln) => /kcl/i.test(ln) && /error/i.test(ln))
  const detailRaw = lines.find((ln) => {
    if (title && ln === title) return false
    const low = ln.toLowerCase()
    return (
      low.includes('interrupted') ||
      low.includes('hangup:') ||
      (low.includes('hangup') && !low.includes('error'))
    )
  })
  const detail = detailRaw?.replace(/^[×xX]\s*/, '').trim()

  let summary: string
  if (detail && title) {
    const detailBody = detail.includes(':')
      ? detail.split(':').slice(1).join(':').trim()
      : detail
    if (detailBody && !title.toLowerCase().includes(detailBody.toLowerCase())) {
      summary = `${title}: ${detailBody}`
    } else summary = title
  } else if (detail) summary = detail
  else if (title) summary = title
  else summary = lines[0] ?? text.trim()

  summary = summary.replace(/\s+/g, ' ').trim()
  if (summary.length > 480) return `${summary.slice(0, 479).trimEnd()}…`
  return summary || 'Unknown error'
}

/** Clean Workbench log lines (ANSI / Python tuple dumps) without losing the prefix. */
export function sanitizeLogMessage(raw: string | null | undefined): string {
  if (!raw) return ''
  const dumpAt = raw.search(/\(\s*['"]\\x1b|\(\s*['"]\u001b|\\x1b\[|\u001b\[/i)
  if (dumpAt >= 0) {
    const prefix = raw.slice(0, dumpAt).trimEnd()
    const dump = raw.slice(dumpAt).trim()
    const summary = formatJobError(dump.startsWith('(') ? dump : raw.slice(dumpAt))
    if (prefix) {
      // Keep "STL export hit a retryable Engine error (2 attempt(s) left):"
      const trimmed = prefix.replace(/:\s*$/, '')
      return `${trimmed}: ${summary}`
    }
    return summary
  }
  return stripAnsi(decodePyStringEscapes(raw))
}
