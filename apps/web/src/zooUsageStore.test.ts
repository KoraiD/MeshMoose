import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearApiToken, setApiToken, type ZooUsage } from './api'
import * as api from './api'
import {
  clearZooUsageCache,
  ensureZooUsageAutoRefresh,
  getZooUsageState,
  refreshZooUsage,
  resetZooUsageStoreForTests,
  setZooUsageAutoRefresh,
  syncZooUsagePolling,
  ZOO_USAGE_AUTO_INTERVAL_MS,
} from './zooUsageStore'

const sampleUsage = (n: number): ZooUsage => ({
  balance: {
    plan_name: 'Free',
    monthly_api_credits_remaining: n,
    monthly_api_credits_remaining_monetary_value: 1,
    monthly_included_credits: 100,
    monthly_included_monetary_value: 10,
    stable_api_credits_remaining: 0,
    stable_api_credits_remaining_monetary_value: 0,
    pay_as_you_go_credit_price: 0.01,
  },
  recent_totals: { count: n, seconds: n, price: n * 0.01 },
  recent_calls: [],
})

describe('zooUsageStore', () => {
  beforeEach(() => {
    localStorage.clear()
    clearApiToken()
    resetZooUsageStoreForTests()
    vi.useFakeTimers()
  })

  afterEach(() => {
    syncZooUsagePolling()
    resetZooUsageStoreForTests()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps last metrics when a refresh fails', async () => {
    setApiToken('api-test')
    const spy = vi
      .spyOn(api, 'getZooUsage')
      .mockResolvedValueOnce(sampleUsage(3))
      .mockRejectedValueOnce(new Error('network down'))

    await refreshZooUsage()
    expect(getZooUsageState().usage?.recent_totals.count).toBe(3)
    const fetchedAt = getZooUsageState().lastFetchedAt
    expect(fetchedAt).toBeTruthy()

    await refreshZooUsage()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(getZooUsageState().usage?.recent_totals.count).toBe(3)
    expect(getZooUsageState().lastFetchedAt).toBe(fetchedAt)
    expect(getZooUsageState().error).toMatch(/network down/)
  })

  it('auto-refreshes on the 10-minute interval while enabled', async () => {
    setApiToken('api-test')
    const spy = vi
      .spyOn(api, 'getZooUsage')
      .mockResolvedValueOnce(sampleUsage(1))
      .mockResolvedValueOnce(sampleUsage(2))

    setZooUsageAutoRefresh(true)
    await vi.waitFor(() => expect(getZooUsageState().usage?.recent_totals.count).toBe(1))

    await vi.advanceTimersByTimeAsync(ZOO_USAGE_AUTO_INTERVAL_MS)
    await vi.waitFor(() => expect(getZooUsageState().usage?.recent_totals.count).toBe(2))
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('ensureZooUsageAutoRefresh fetches when cache is empty', async () => {
    setApiToken('api-test')
    localStorage.setItem('meshmoose.zooUsageAutoRefresh', '1')
    resetZooUsageStoreForTests()
    vi.spyOn(api, 'getZooUsage').mockResolvedValue(sampleUsage(9))

    ensureZooUsageAutoRefresh()
    await vi.waitFor(() => expect(getZooUsageState().usage?.recent_totals.count).toBe(9))
  })

  it('clearZooUsageCache drops metrics', async () => {
    setApiToken('api-test')
    vi.spyOn(api, 'getZooUsage').mockResolvedValue(sampleUsage(1))
    await refreshZooUsage()
    clearZooUsageCache()
    expect(getZooUsageState().usage).toBeNull()
    expect(getZooUsageState().lastFetchedAt).toBeNull()
  })
})
