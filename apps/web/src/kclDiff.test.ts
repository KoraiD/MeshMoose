import { describe, expect, it } from 'vitest'
import { collapseSame, diffLines } from './kclDiff'

describe('diffLines', () => {
  it('marks added, removed, and unchanged lines', () => {
    const oldText = 'a = 1\nb = 2\nc = 3'
    const newText = 'a = 1\nb = 5\nc = 3\nd = 4'
    const out = diffLines(oldText, newText)
    const byText = new Map(out.map((l) => [l.text, l.kind]))
    expect(byText.get('a = 1')).toBe('same')
    expect(byText.get('b = 2')).toBe('del')
    expect(byText.get('b = 5')).toBe('add')
    expect(byText.get('d = 4')).toBe('add')
  })

  it('returns all-same for identical texts', () => {
    const out = diffLines('x\ny', 'x\ny')
    expect(out.every((l) => l.kind === 'same')).toBe(true)
  })

  it('handles empty old text as all additions', () => {
    const out = diffLines('', 'a\nb')
    expect(out.filter((l) => l.kind === 'add')).toHaveLength(2)
  })
})

describe('collapseSame', () => {
  it('collapses long unchanged runs into a gap', () => {
    const same = Array.from({ length: 20 }, (_, i) => ({
      kind: 'same' as const,
      text: `line ${i}`,
    }))
    const out = collapseSame(same, 2)
    const gap = out.find((l) => l.kind === 'gap')
    expect(gap).toBeDefined()
    expect((gap as { count: number }).count).toBe(16)
  })

  it('keeps short runs intact', () => {
    const lines = [
      { kind: 'same' as const, text: 'a' },
      { kind: 'add' as const, text: 'b' },
      { kind: 'same' as const, text: 'c' },
    ]
    const out = collapseSame(lines, 2)
    expect(out).toHaveLength(3)
    expect(out.some((l) => l.kind === 'gap')).toBe(false)
  })
})
