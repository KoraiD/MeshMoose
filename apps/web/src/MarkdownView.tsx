import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo } from 'react'

marked.setOptions({ gfm: true, breaks: true })

type Props = {
  text: string
  empty?: string
}

export function MarkdownView({ text, empty = '(streaming…)' }: Props) {
  const html = useMemo(() => {
    if (!text.trim()) return ''
    // Assistant text is agent-controlled; sanitize before injecting HTML.
    const raw = marked.parse(text, { async: false }) as string
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
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
