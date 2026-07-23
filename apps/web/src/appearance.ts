/** Parse / apply KCL appearance() materials for Live Engine. */

export type AppearanceMaterial = {
  color: string
  metalness: number
  roughness: number
  opacity: number
}

/** Last `appearance(...)` call in a KCL source string. */
export function parseLastAppearance(kcl: string): AppearanceMaterial | null {
  if (!kcl.trim()) return null
  const matches = [...kcl.matchAll(/appearance\s*\(([\s\S]*?)\)/g)]
  const last = matches.at(-1)
  if (!last) return null
  const inner = last[1]
  const color = inner.match(/color\s*=\s*"([^"]+)"/)?.[1]
  if (!color) return null
  const metalness = Number(inner.match(/metalness\s*=\s*(-?[\d.]+)/)?.[1] ?? 0)
  const roughness = Number(inner.match(/roughness\s*=\s*(-?[\d.]+)/)?.[1] ?? 50)
  const opacityRaw = inner.match(/opacity\s*=\s*(-?[\d.]+)/)?.[1]
  const opacity = opacityRaw != null ? Number(opacityRaw) : 100
  return { color, metalness, roughness, opacity }
}

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const n = Number.parseInt(h, 16)
  if (!Number.isFinite(n) || h.length !== 6) return { r: 0.75, g: 0.75, b: 0.78 }
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  }
}
