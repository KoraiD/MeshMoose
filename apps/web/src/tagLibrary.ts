/** Centralized tag vocabulary (defaults + user-added). */

import { appLog } from './appLog'

const STORAGE_KEY = 'meshmoose.tagLibrary'
export const MAX_TAG_LEN = 24
export const MAX_JOB_TAGS = 5

export const DEFAULT_TAGS = [
  'demo',
  'stand',
  'bracket',
  'washer',
  'coin',
  'print',
  'prototype',
  'refine',
] as const

function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LEN)
}

function readCustom(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (typeof item !== 'string') continue
      const tag = normalizeTag(item)
      if (!tag) continue
      const key = tag.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(tag)
    }
    return out
  } catch {
    return []
  }
}

function writeCustom(tags: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tags))
}

/** Defaults first, then custom (case-insensitive unique). */
export function listTags(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of [...DEFAULT_TAGS, ...readCustom()]) {
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

export function isDefaultTag(tag: string): boolean {
  const key = tag.toLowerCase()
  return DEFAULT_TAGS.some((t) => t.toLowerCase() === key)
}

/** Add a tag to the library (no-op if already present). Returns normalized tag. */
export function addTagToLibrary(raw: string): string {
  const tag = normalizeTag(raw)
  if (!tag) throw new Error('Tag is empty')
  if (isDefaultTag(tag)) return tag
  const custom = readCustom()
  if (custom.some((t) => t.toLowerCase() === tag.toLowerCase())) return tag
  custom.push(tag)
  writeCustom(custom)
  appLog(`Added tag “${tag}” to library`)
  return tag
}

export function removeTagFromLibrary(raw: string): void {
  const tag = normalizeTag(raw)
  if (!tag) return
  if (isDefaultTag(tag)) {
    throw new Error('Built-in tags cannot be removed')
  }
  writeCustom(readCustom().filter((t) => t.toLowerCase() !== tag.toLowerCase()))
  appLog(`Removed tag “${tag}” from library`, 'warn')
}

/** Filter library tags by a query (case-insensitive substring).
 * Custom tags are listed before built-ins so they aren't buried under defaults.
 */
export function filterTags(query: string, exclude: string[] = []): string[] {
  const q = query.trim().toLowerCase()
  const excluded = new Set(exclude.map((t) => t.toLowerCase()))
  const matched = listTags().filter((t) => {
    if (excluded.has(t.toLowerCase())) return false
    if (!q) return true
    return t.toLowerCase().includes(q)
  })
  return matched.sort((a, b) => {
    const aDef = isDefaultTag(a) ? 1 : 0
    const bDef = isDefaultTag(b) ? 1 : 0
    if (aDef !== bDef) return aDef - bDef
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  })
}
