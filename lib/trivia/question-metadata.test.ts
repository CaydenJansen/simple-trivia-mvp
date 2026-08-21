import { describe, expect, it } from 'vitest'

import {
  buildDiversityFingerprint,
  deriveMultiPartSummary,
  editorialDifficultyFromLegacy,
  isSourceQuestionCategory,
  mechanicFromLegacyQuestionType,
} from './question-metadata'

describe('legacy question metadata compatibility', () => {
  it('normalizes an image question to its real single-answer mechanic', () => {
    expect(mechanicFromLegacyQuestionType('image-question')).toBe('single-answer')
    expect(mechanicFromLegacyQuestionType('ranking')).toBe('ranking')
    expect(mechanicFromLegacyQuestionType('unknown')).toBeNull()
  })

  it('maps the five legacy difficulty labels to numeric editorial difficulty', () => {
    expect(['Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard'].map(editorialDifficultyFromLegacy))
      .toEqual([1, 2, 3, 4, 5])
    expect(editorialDifficultyFromLegacy('Unrated')).toBeNull()
  })

  it('does not treat General Knowledge or Mixed as source categories', () => {
    expect(isSourceQuestionCategory('Science & Nature')).toBe(true)
    expect(isSourceQuestionCategory('General Knowledge')).toBe(false)
    expect(isSourceQuestionCategory('Mixed')).toBe(false)
  })
})

describe('multi-part metadata', () => {
  const parts = [
    { categories: ['Science & Nature'], tags: ['physics', 'relativity'], editorialDifficulty: 2 },
    { categories: ['Arts & Literature'], tags: ['Orwell', 'dystopian fiction'], editorialDifficulty: 3 },
    { categories: ['Sport'], tags: ['football', 'Argentina'], editorialDifficulty: 5 },
  ]

  it('derives category and difficulty ranges from the parts', () => {
    expect(deriveMultiPartSummary(parts)).toEqual({
      categories: ['Science & Nature', 'Arts & Literature', 'Sport'],
      tags: ['physics', 'relativity', 'Orwell', 'dystopian fiction', 'football', 'Argentina'],
      difficultyMin: 2,
      difficultyMax: 5,
    })
  })

  it('includes part and bonus metadata in the diversity fingerprint', () => {
    expect(buildDiversityFingerprint({
      question: {
        mechanic: 'multi-part',
        promptPattern: 'match-clue-answer',
        stability: 'stable',
      },
      parts,
      bonus: {
        categories: ['History'],
        tags: ['World War II'],
        mechanic: 'single-answer',
        promptPattern: 'year-date',
        answerType: 'year-date',
        editorialDifficulty: 4,
        hasMedia: true,
        stability: 'review_periodically',
      },
    })).toEqual({
      categories: ['Science & Nature', 'Arts & Literature', 'Sport', 'History'],
      tags: ['physics', 'relativity', 'Orwell', 'dystopian fiction', 'football', 'Argentina', 'World War II'],
      mechanics: ['multi-part', 'single-answer'],
      promptPatterns: ['match-clue-answer', 'year-date'],
      answerTypes: ['year-date'],
      difficultyMin: 2,
      difficultyMax: 5,
      hasMedia: true,
      hasBonus: true,
      stabilities: ['stable', 'review_periodically'],
    })
  })
})
