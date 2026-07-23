import { describe, expect, it } from 'vitest'
import {
  convertVolumeFromCm3,
  volumeUnitLabel,
} from './metricUnits'

describe('convertVolumeFromCm3', () => {
  it('keeps cm³', () => {
    expect(convertVolumeFromCm3(2.5, 'cm3')).toBe(2.5)
  })

  it('converts to mm³', () => {
    expect(convertVolumeFromCm3(1, 'mm3')).toBe(1000)
  })

  it('converts to in³', () => {
    expect(convertVolumeFromCm3(16.387064, 'in3')).toBeCloseTo(1, 6)
  })
})

describe('volumeUnitLabel', () => {
  it('labels each unit', () => {
    expect(volumeUnitLabel('mm3')).toBe('mm³')
    expect(volumeUnitLabel('cm3')).toBe('cm³')
    expect(volumeUnitLabel('in3')).toBe('in³')
  })
})
