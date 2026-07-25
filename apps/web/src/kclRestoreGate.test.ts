import { describe, expect, it } from 'vitest'
import { canRestoreKclVersion } from './kclRestoreGate'

describe('canRestoreKclVersion', () => {
  it('allows restore when the job is idle', () => {
    expect(canRestoreKclVersion({ status: 'succeeded' })).toBe(true)
    expect(canRestoreKclVersion({ status: 'failed' })).toBe(true)
  })

  it('allows restore even when main.kcl is absent (gate ignores hasKcl)', () => {
    // Caller may have versions listed while artifacts/kcl state is empty.
    expect(canRestoreKclVersion({ status: 'succeeded' })).toBe(true)
  })

  it('disables restore while the pipeline is running', () => {
    expect(canRestoreKclVersion({ status: 'queued' })).toBe(false)
    expect(canRestoreKclVersion({ status: 'agent_running' })).toBe(false)
    expect(canRestoreKclVersion({ status: 'exporting' })).toBe(false)
    expect(canRestoreKclVersion({ status: 'measuring' })).toBe(false)
  })

  it('disables restore with no job', () => {
    expect(canRestoreKclVersion(null)).toBe(false)
    expect(canRestoreKclVersion(undefined)).toBe(false)
  })
})
