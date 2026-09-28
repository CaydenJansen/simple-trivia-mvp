import { describe, expect, it } from 'vitest'

import { effectiveTriviaDifficulty, effectiveDifficultyFilter, TRIVIA_DIFFICULTIES, triviaDifficultyTone } from './difficulty'

describe('difficulty presentation', () => {
  it('F15 filters by observed difficulty, using editorial difficulty only when unobserved', () => {
    expect(effectiveDifficultyFilter(4)).toBe('observed_difficulty.eq.4,and(observed_difficulty.is.null,editorial_difficulty.eq.4)')
    expect(() => effectiveDifficultyFilter(0)).toThrow('Invalid difficulty')
  })
  it('maps the five difficulty levels from green through red in order', () => {
    expect(TRIVIA_DIFFICULTIES.map(triviaDifficultyTone)).toEqual([
      'very-easy',
      'easy',
      'medium',
      'hard',
      'very-hard',
    ])
  })

  it('keeps unknown or missing legacy labels visually neutral', () => {
    expect(triviaDifficultyTone('Unrated')).toBe('unrated')
  })

  it('uses observed difficulty once it is available', () => {
    expect(effectiveTriviaDifficulty(4, 2, 'Easy')).toBe('Hard')
  })

  it('keeps editorial difficulty until observed data exists', () => {
    expect(effectiveTriviaDifficulty(null, 3, 'Easy')).toBe('Medium')
  })

  it('falls back safely for unrated legacy questions', () => {
    expect(effectiveTriviaDifficulty(null, null, 'Custom')).toBe('Custom')
  })
})
