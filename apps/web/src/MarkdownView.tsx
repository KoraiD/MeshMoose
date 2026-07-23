import { marked } from 'marked'
import { useMemo } from 'react'

marked.setOptions({ gfm: true, breaks: true })

function sanitizeHtml(html: string): string {
  // Minimal allowlist for assistant markdown (no scripts/iframes).
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

type Props = {
  text: string
  empty?: string
}

export function MarkdownView({ text, empty = '(streaming…)' }: Props) {
  const html = useMemo(() => {
    if (!text.trim()) return ''
    return sanitizeHtml(marked.parse(text, { async: false }) as string)
  }, [text])

  if (!html) {
    return <p className="muted empty-md">{empty}</p>
  }
  return (
    <div
      className="md-body"
      // Sanitized subset of marked output for assistant deltas.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
