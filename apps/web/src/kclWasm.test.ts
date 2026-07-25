import { describe, expect, it } from 'vitest'
import { analyzeKcl, formatKcl } from './kclWasm'

const SAMPLE = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)
`

describe('kclWasm', () => {
  it('reports parse errors for broken KCL', async () => {
    const issues = await analyzeKcl('x = (\n')
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((i) => i.severity === 'error')).toBe(true)
    expect(issues[0]?.message.toLowerCase()).toMatch(/expected|unexpected|end of file/)
  }, 20_000)

  it('accepts a simple valid program', async () => {
    const issues = await analyzeKcl(SAMPLE)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  }, 20_000)

  it('formats valid KCL via recast', async () => {
    const messy = SAMPLE.replace(/\n/g, '\n\n')
    const formatted = await formatKcl(messy)
    expect(formatted).toContain('startSketchOn')
    expect(formatted).toContain('extrude')
    expect(formatted.endsWith('\n')).toBe(true)
  }, 20_000)

  it('rejects format when parse fails', async () => {
    await expect(formatKcl('x = (\n')).rejects.toThrow()
  }, 20_000)
})
