import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import { kclLanguage } from './kclLanguage'
import { analyzeKcl } from './kclWasm'

type Props = {
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function editorTheme() {
  const fg = cssVar('--ink', '#0f172a')
  const muted = cssVar('--muted', '#64748b')
  const bg = cssVar('--code-bg', '#f8fafc')
  const line = cssVar('--line', '#d5dbe5')
  const accent = cssVar('--accent', '#0f766e')
  const danger = cssVar('--danger', '#b91c1c')
  const warn = cssVar('--warn', '#b45309')
  const mono = cssVar('--mono', 'ui-monospace, SFMono-Regular, Menlo, monospace')
  const kw = cssVar('--code-keyword', accent)
  const str = cssVar('--code-string', '#0b6e4f')
  const num = cssVar('--code-number', '#a16207')
  const op = cssVar('--code-operator', '#475569')
  const name = cssVar('--code-name', fg)
  const comment = cssVar('--code-comment', muted)
  const dark = document.documentElement.dataset.theme === 'dark'
  const highlight = HighlightStyle.define([
    { tag: tags.keyword, color: dark ? '#5eead4' : kw, fontWeight: '600' },
    { tag: tags.comment, color: comment, fontStyle: 'italic' },
    { tag: tags.string, color: dark ? '#6ee7b7' : str },
    { tag: tags.number, color: dark ? '#fbbf24' : num },
    { tag: tags.variableName, color: dark ? '#e2e8f0' : name },
    { tag: tags.operator, color: dark ? '#94a3b8' : op },
  ])
  return [
    syntaxHighlighting(highlight),
    EditorView.theme(
      {
        '&': {
          color: fg,
          backgroundColor: bg,
          fontSize: '0.8rem',
          fontFamily: mono,
        },
        '.cm-content': {
          caretColor: accent,
          minHeight: '220px',
          fontFamily: mono,
        },
        '.cm-gutters': {
          backgroundColor: bg,
          color: muted,
          borderRight: `1px solid ${line}`,
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'transparent',
          color: fg,
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
          backgroundColor: `color-mix(in srgb, ${accent} 28%, transparent)`,
        },
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: accent,
        },
        '.cm-placeholder': {
          color: muted,
        },
        '.cm-diagnostic-error': {
          borderBottom: `1px wavy ${danger}`,
        },
        '.cm-diagnostic-warning': {
          borderBottom: `1px wavy ${warn}`,
        },
        '.cm-lintRange-error': {
          backgroundImage: 'none',
          borderBottom: `1px wavy ${danger}`,
        },
        '.cm-lintRange-warning': {
          backgroundImage: 'none',
          borderBottom: `1px wavy ${warn}`,
        },
      },
      { dark },
    ),
  ]
}

const kclLinter = linter(
  async (view): Promise<Diagnostic[]> => {
    const source = view.state.doc.toString()
    if (!source.trim()) return []
    try {
      const issues = await analyzeKcl(source)
      return issues.map((issue) => ({
        from: issue.from,
        to: Math.max(issue.to, issue.from),
        severity: issue.severity,
        message: issue.message,
      }))
    } catch (err) {
      return [
        {
          from: 0,
          to: Math.min(1, source.length),
          severity: 'error',
          message: err instanceof Error ? err.message : 'KCL analysis failed',
        },
      ]
    }
  },
  { delay: 450 },
)

export function KclEditor({ value, onChange, ariaLabel }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        lintGutter(),
        history(),
        kclLanguage,
        kclLinter,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        placeholder('// Edit main.kcl — Save to disk, Run to execute live'),
        ...editorTheme(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        EditorView.editorAttributes.of({
          'aria-label': ariaLabel || 'KCL editor',
        }),
      ],
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Mount once; external value sync is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  return <div className="kcl-editor" ref={hostRef} />
}
