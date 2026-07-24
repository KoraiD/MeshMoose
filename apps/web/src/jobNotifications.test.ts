import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimJobTerminalTransition,
  resetNotifiedJobsForTests,
} from './jobNotifications'

const running = (s: string) =>
  ['queued', 'preprocessing', 'agent_running', 'exporting', 'measuring'].includes(s)

describe('claimJobTerminalTransition', () => {
  beforeEach(() => {
    resetNotifiedJobsForTests()
  })

  it('claims running → failed once', () => {
    expect(claimJobTerminalTransition('j1', 'exporting', 'failed', running)).toBe(true)
    expect(claimJobTerminalTransition('j1', 'exporting', 'failed', running)).toBe(false)
  })

  it('ignores first sighting of an already-failed job', () => {
    expect(claimJobTerminalTransition('j1', undefined, 'failed', running)).toBe(false)
  })

  it('ignores non-terminal updates', () => {
    expect(claimJobTerminalTransition('j1', 'queued', 'agent_running', running)).toBe(
      false,
    )
  })
})
