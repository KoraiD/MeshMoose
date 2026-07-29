import { describe, expect, it } from 'vitest'
import { formatJobError, sanitizeLogMessage } from './jobError'

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

describe('sanitizeLogMessage', () => {
  it('keeps export retry prefix and shortens ANSI dump', () => {
    const raw =
      "STL export hit a retryable Engine error (2 attempt(s) left): ('\\x1b[31mKCL EngineHangup error\\x1b[0m\\n\\n  \\x1b[31m×\\x1b[0m engine hangup: modeling connection interrupted; please reconnect and retry\\n  \\x1b[31m│\\x1b[0m (API call ID: 6eb7897c-5e67-4c51-a451-bdeb8850d2c2)\\n     ╭─[479:25]\\n \\x1b[2m478\\x1b[0m │ )\\n \\x1b[2m479\\x1b[0m │ hoopWithLargeCavities = subtract(notchedHoop, tools = flatten([rightLargeCavities, leftLargeCavities]))\\n     · \\x1b[35;1m                        ───────────────────────────────────────┬───────────────────────────────────────\\x1b[0m\\n     ╰────\\n', True)"
    const out = sanitizeLogMessage(raw)
    expect(out).toContain('STL export hit a retryable Engine error')
    expect(out.toLowerCase()).toContain('hangup')
    expect(out).not.toContain('\\x1b')
    expect(out).not.toContain('hoopWithLargeCavities')
    expect(out.length).toBeLessThan(220)
  })

  it('passes through plain log lines', () => {
    expect(sanitizeLogMessage('Wrote generated.stl (751360 B)')).toBe(
      'Wrote generated.stl (751360 B)',
    )
  })
})
