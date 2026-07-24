import { describe, expect, it } from 'vitest'
import { formatJobError } from './jobError'

describe('formatJobError', () => {
  it('unwraps ANSI tuple repr from Zoo KclError', () => {
    const raw =
      "('\\x1b[31mKCL EngineHangup error\\x1b[0m\\n\\n  \\x1b[31m×\\x1b[0m engine hangup: modeling connection interrupted; please reconnect and retry\\n  \\x1b[31m│\\x1b[0m (API call ID: 3889111f-0f29-4540-8741-36d91936882a)\\n', True)"
    const out = formatJobError(raw)
    expect(out.toLowerCase()).toContain('hangup')
    expect(out.toLowerCase()).toContain('interrupted')
    expect(out).not.toMatch(/\u001b/)
    expect(out).not.toContain('True)')
  })

  it('passes through plain messages', () => {
    expect(formatJobError('Export failed')).toBe('Export failed')
  })
})
