import { describe, expect, it } from 'vitest'

import { errorMessage, normalizeClientErrorReport } from './client-error'

describe('client error monitoring', () => {
  it('rejects malformed reports', () => {
    expect(normalizeClientErrorReport(null)).toBeNull()
    expect(normalizeClientErrorReport({ message: '   ' })).toBeNull()
  })

  it('removes query strings and truncates unsafe client data', () => {
    const report = normalizeClientErrorReport({
      kind: 'unhandled-rejection',
      message: `Failure\u0000${'x'.repeat(5_000)}`,
      stack: 'stack',
      digest: 'digest',
      path: '/play?code=123456#answer',
      userAgent: 'test browser',
      occurredAt: '2026-08-26T00:00:00.000Z',
    })

    expect(report).toMatchObject({
      kind: 'unhandled-rejection',
      path: '/play',
      userAgent: 'test browser',
      occurredAt: '2026-08-26T00:00:00.000Z',
    })
    expect(report?.message).not.toContain('\u0000')
    expect(report?.message).toHaveLength(4_000)
  })

  it('turns rejection values into useful messages', () => {
    expect(errorMessage(new Error('Network failed'))).toBe('Network failed')
    expect(errorMessage({ code: 'PGRST001' })).toBe('{"code":"PGRST001"}')
  })
})
