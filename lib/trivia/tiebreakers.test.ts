import { describe, expect, it } from 'vitest'
import {
  AUTO_BUILD_TIEBREAKER_COUNT,
  availableTiebreakerReplacements,
  evaluateClosestAnswers,
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

  it('offers unused replacements with matching category and difficulty first', () => {
    const options = [
      { id: 'current', primary_category_id: 'sport', editorial_difficulty: 3 },
      { id: 'used', primary_category_id: 'sport', editorial_difficulty: 3 },
      { id: 'same-category', primary_category_id: 'sport', editorial_difficulty: 4 },
      { id: 'same-difficulty', primary_category_id: 'music', editorial_difficulty: 3 },
      { id: 'best-fit', primary_category_id: 'sport', editorial_difficulty: 3 },
    ]

    expect(availableTiebreakerReplacements(options, 'current', new Set(['current', 'used'])).map(option => option.id))
      .toEqual(['best-fit', 'same-category', 'same-difficulty'])
  })

  it('orders numeric answers by absolute distance from the correct value', () => {
    expect(evaluateClosestAnswers(21196, [
      { teamId: 'team-a', value: 20000 },
      { teamId: 'team-b', value: 15000 },
    ])).toMatchObject({
      unresolved: false,
      orderedTeamIds: ['team-a', 'team-b'],
      ranked: [
        { teamId: 'team-a', value: 20000, distance: 1196 },
        { teamId: 'team-b', value: 15000, distance: 6196 },
      ],
    })
  })

  it('keeps an equal-distance result unresolved', () => {
    expect(evaluateClosestAnswers(100, [
      { teamId: 'team-a', value: 90 },
      { teamId: 'team-b', value: 110 },
    ])).toMatchObject({ unresolved: true, orderedTeamIds: null })
  })
})
