import { describe, expect, it } from 'vitest'

import { TRIVIA_DIFFICULTIES, triviaDifficultyTone } from './difficulty'

describe('difficulty presentation', () => {
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
})
