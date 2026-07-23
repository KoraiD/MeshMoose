import { describe, expect, it } from 'vitest'
import { hexToRgb01, parseLastAppearance } from './appearance'

describe('parseLastAppearance', () => {
  it('reads the last appearance call', () => {
    const kcl = `
part = extrude(length = 2)
  |> appearance(color = "#B8B8B8", metalness = 100, roughness = 30)
other = appearance(color = "#CC0000", metalness = 100, roughness = 25, opacity = 90)
`
    const mat = parseLastAppearance(kcl)
    expect(mat).toEqual({
      color: '#CC0000',
      metalness: 100,
      roughness: 25,
      opacity: 90,
    })
  })

  it('defaults opacity to 100 when omitted', () => {
    const mat = parseLastAppearance(
      'x = appearance(color = "#4A90E2", metalness = 0, roughness = 60)',
    )
    expect(mat?.opacity).toBe(100)
  })

  it('returns null without appearance', () => {
    expect(parseLastAppearance('part = extrude(length = 2)')).toBeNull()
  })
})

describe('hexToRgb01', () => {
  it('parses six-digit hex', () => {
    expect(hexToRgb01('#FF0000')).toEqual({ r: 1, g: 0, b: 0 })
  })

  it('expands three-digit hex', () => {
    expect(hexToRgb01('#0f0')).toEqual({ r: 0, g: 1, b: 0 })
  })
})
