import { beforeEach, describe, expect, it } from 'vitest'
import {
  addTagToLibrary,
  filterTags,
  isDefaultTag,
  listTags,
  removeTagFromLibrary,
} from './tagLibrary'

describe('tagLibrary', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('includes defaults', () => {
    expect(listTags()).toContain('demo')
    expect(isDefaultTag('Demo')).toBe(true)
  })

  it('adds and filters custom tags', () => {
    addTagToLibrary('  My Part  ')
    expect(listTags()).toContain('My Part')
    expect(filterTags('my', ['demo'])).toContain('My Part')
    removeTagFromLibrary('My Part')
    expect(listTags()).not.toContain('My Part')
  })

  it('lists custom tags before built-ins in suggestions', () => {
    addTagToLibrary('brick')
    const suggestions = filterTags('')
    expect(suggestions[0]).toBe('brick')
    expect(suggestions).toContain('demo')
  })

  it('rejects removing defaults', () => {
    expect(() => removeTagFromLibrary('demo')).toThrow(/Built-in/)
  })
})
