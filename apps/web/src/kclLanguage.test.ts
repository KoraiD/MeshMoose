import { describe, expect, it } from 'vitest'
import { KCL_KEYWORDS } from './highlight'
import { kclLanguage } from './kclLanguage'

describe('kclLanguage', () => {
  it('exports a named stream language', () => {
    expect(kclLanguage.name).toBe('kcl')
  })

  it('shares keyword set with Workbench highlighter', () => {
    expect(KCL_KEYWORDS.has('fn')).toBe(true)
    expect(KCL_KEYWORDS.has('import')).toBe(true)
    expect(KCL_KEYWORDS.has('extrude')).toBe(false)
  })
})
