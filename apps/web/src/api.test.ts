import { describe, expect, it, beforeEach } from 'vitest'
import { clearApiToken, getApiToken, setApiToken } from './api'

describe('api token storage', () => {
  beforeEach(() => {
    clearApiToken()
  })

  it('stores and reads token from localStorage', () => {
    expect(getApiToken()).toBe('')
    setApiToken('  api-test-token  ')
    expect(getApiToken()).toBe('api-test-token')
  })
})
