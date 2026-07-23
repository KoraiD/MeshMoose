export type VolumeUnit = 'cm3' | 'mm3' | 'in3'

export const VOLUME_UNITS: { id: VolumeUnit; label: string }[] = [
  { id: 'mm3', label: 'mm³' },
  { id: 'cm3', label: 'cm³' },
  { id: 'in3', label: 'in³' },
]

const STORAGE_KEY = 'meshmoose.volumeUnit'

/** Metrics JSON stores volume in cm³. */
export function convertVolumeFromCm3(value: number, unit: VolumeUnit): number {
  switch (unit) {
    case 'cm3':
      return value
    case 'mm3':
      return value * 1000
    case 'in3':
      return value / 16.387064
    default: {
      const _exhaustive: never = unit
      return _exhaustive
    }
  }
}

export function volumeUnitLabel(unit: VolumeUnit): string {
  switch (unit) {
    case 'cm3':
      return 'cm³'
    case 'mm3':
      return 'mm³'
    case 'in3':
      return 'in³'
    default: {
      const _exhaustive: never = unit
      return _exhaustive
    }
  }
}

export function getVolumeUnit(): VolumeUnit {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === 'mm3' || raw === 'cm3' || raw === 'in3') return raw
  return 'cm3'
}

export function setVolumeUnit(unit: VolumeUnit): void {
  localStorage.setItem(STORAGE_KEY, unit)
}

export function formatVolume(value: number, unit: VolumeUnit): string {
  const n = convertVolumeFromCm3(value, unit)
  return n.toPrecision(4)
}
