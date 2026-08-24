import { describe, expect, it } from 'vitest'

import {
  STARTER_QUESTION_TAG_ALIASES,
  STARTER_QUESTION_TAGS,
  isStarterTagOrAlias,
  normalizeTagPhrase,
} from './question-library-tags'

describe('Question Library controlled tag vocabulary', () => {
  it('keeps canonical names unique after import normalization', () => {
    const normalized = STARTER_QUESTION_TAGS.map(normalizeTagPhrase)
    expect(new Set(normalized).size).toBe(normalized.length)
  })

  it('only points aliases at approved canonical tags', () => {
    expect(Object.values(STARTER_QUESTION_TAG_ALIASES).every(tag => (
      STARTER_QUESTION_TAGS.includes(tag as (typeof STARTER_QUESTION_TAGS)[number])
    ))).toBe(true)
    expect(isStarterTagOrAlias(' U.S. ')).toBe(true)
    expect(isStarterTagOrAlias('Pokémon')).toBe(true)
    expect(isStarterTagOrAlias('Pokemon')).toBe(true)
  })

  it('does not make broad or ambiguous semantic guesses', () => {
    expect(isStarterTagOrAlias('Music')).toBe(false)
    expect(isStarterTagOrAlias('History')).toBe(false)
    expect(isStarterTagOrAlias('football')).toBe(false)
    expect(isStarterTagOrAlias('Films')).toBe(false)
  })
})
