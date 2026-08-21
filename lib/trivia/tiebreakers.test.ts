import { describe, expect, it } from 'vitest'
import {
  AUTO_BUILD_TIEBREAKER_COUNT,
  hasRequiredAutoBuildTiebreakers,
  isValidTiebreakerNumericValue,
  needsMoreManualTiebreakers,
} from './tiebreakers'

describe('prepared tiebreaker authoring semantics', () => {
  it('accepts integer, decimal, signed, and zero numeric answers', () => {
    expect(isValidTiebreakerNumericValue('21196')).toBe(true)
    expect(isValidTiebreakerNumericValue(' 12.5 ')).toBe(true)
    expect(isValidTiebreakerNumericValue('-3')).toBe(true)
    expect(isValidTiebreakerNumericValue('0')).toBe(true)
  })

  it('rejects blank and non-numeric answers', () => {
    expect(isValidTiebreakerNumericValue('')).toBe(false)
    expect(isValidTiebreakerNumericValue('twenty')).toBe(false)
    expect(isValidTiebreakerNumericValue('12 km')).toBe(false)
    expect(isValidTiebreakerNumericValue('1,000')).toBe(false)
  })

  it('recommends two manual tiebreakers without making them mandatory', () => {
    expect(needsMoreManualTiebreakers(0)).toBe(true)
    expect(needsMoreManualTiebreakers(1)).toBe(true)
    expect(needsMoreManualTiebreakers(2)).toBe(false)
  })

  it('requires exactly three prepared tiebreakers for auto-build', () => {
    expect(AUTO_BUILD_TIEBREAKER_COUNT).toBe(3)
    expect(hasRequiredAutoBuildTiebreakers(3)).toBe(true)
    expect(hasRequiredAutoBuildTiebreakers(2)).toBe(false)
    expect(hasRequiredAutoBuildTiebreakers(4)).toBe(false)
  })
})
