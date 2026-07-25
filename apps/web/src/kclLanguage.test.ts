import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { KCL_KEYWORDS } from './highlight'
import { kclLanguage } from './kclLanguage'

function tokenNames(source: string): string[] {
  const state = EditorState.create({
    doc: source,
    extensions: [kclLanguage],
  })
  const names: string[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.type.isError || node.from === node.to) return
      const name = node.type.name
      if (name && name !== 'Document') names.push(name)
    },
  })
  return names
}

describe('kclLanguage', () => {
  it('exports a named stream language', () => {
    expect(kclLanguage.name).toBe('kcl')
  })

  it('shares keyword set with Workbench highlighter', () => {
    expect(KCL_KEYWORDS.has('fn')).toBe(true)
    expect(KCL_KEYWORDS.has('import')).toBe(true)
    expect(KCL_KEYWORDS.has('extrude')).toBe(false)
  })

  it('tokenizes comments, strings, numbers, and keywords', () => {
    const names = tokenNames(`// note\nfn box = 12\nlabel = "hi"\n`)
    expect(names).toContain('comment')
    expect(names).toContain('keyword')
    expect(names).toContain('number')
    expect(names).toContain('string')
  })
})
