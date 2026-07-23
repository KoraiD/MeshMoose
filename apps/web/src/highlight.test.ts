import { describe, expect, it } from 'vitest'
import { flattenMetrics, highlightJson, highlightKcl } from './highlight'

describe('highlight', () => {
  it('colors kcl keywords', () => {
    const html = highlightKcl('const x = 1 // hi')
    expect(html).toContain('tok-kw')
    expect(html).toContain('tok-number')
    expect(html).toContain('tok-comment')
  })

  it('pretty-prints json', () => {
    const html = highlightJson('{"a":1}')
    expect(html).toContain('tok-key')
    expect(html).toContain('tok-number')
  })

  it('flattens metrics', () => {
    const rows = flattenMetrics({ delta: { volume: { abs: 1 } } })
    expect(rows.some((r) => r.key === 'delta.volume.abs')).toBe(true)
  })
})
