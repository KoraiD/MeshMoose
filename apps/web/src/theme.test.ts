import { beforeEach, describe, expect, it } from 'vitest'
import { appLog, clearAppLogs, getAppLogs } from './appLog'
import { applyTheme, getThemePreference, setThemePreference } from './theme'

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to system and applies a resolved theme', () => {
    expect(getThemePreference()).toBe('system')
    const resolved = applyTheme('light')
    expect(resolved).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    setThemePreference('dark')
    expect(getThemePreference()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('app log', () => {
  beforeEach(() => {
    clearAppLogs()
  })

  it('records and clears entries', () => {
    appLog('hello')
    appLog('boom', 'error')
    const logs = getAppLogs()
    expect(logs).toHaveLength(2)
    expect(logs[1].level).toBe('error')
    clearAppLogs()
    expect(getAppLogs()).toHaveLength(0)
  })
})
