import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { kclLanguage } from './kclLanguage'

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
  const mono = cssVar('--mono', 'ui-monospace, SFMono-Regular, Menlo, monospace')
  return EditorView.theme(
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
    },
    { dark: document.documentElement.dataset.theme === 'dark' },
  )
}

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
        history(),
        kclLanguage,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        placeholder('// Edit main.kcl — Save to disk, Run to execute live'),
        editorTheme(),
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
