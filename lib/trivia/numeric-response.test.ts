import { describe, expect, it } from 'vitest'

import { formatNumericResponse, formatNumericResponseInput, parseNumericResponseInput } from './numeric-response'

describe('numeric response formatting', () => {
  it('adds readable thousands separators while typing', () => {
    expect(formatNumericResponseInput('2000000')).toBe('2,000,000')
    expect(formatNumericResponseInput('2,000,000')).toBe('2,000,000')
    expect(formatNumericResponseInput('-12345.67')).toBe('-12,345.67')
  })

  it('parses the formatted value for submission', () => {
    expect(parseNumericResponseInput('2,000,000')).toBe(2_000_000)
    expect(parseNumericResponseInput('')).toBeNull()
  })

  it('formats persisted numeric responses consistently', () => {
    expect(formatNumericResponse(3000000)).toBe('3,000,000')
  })
})
