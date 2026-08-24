import { describe, expect, it } from 'vitest'

import {
  buildDiversityFingerprint,
  deriveQuestionPackageMetadata,
  deriveMultiPartSummary,
  editorialDifficultyFromLegacy,
  isSourceQuestionCategory,
  mechanicFromLegacyQuestionType,
  resolveInheritedQuestionMetadata,
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

describe('question-package metadata inheritance', () => {
  const parent = {
    categories: ['Science & Nature'],
    tags: ['eclipses'],
    editorialDifficulty: 2,
    stability: 'stable' as const,
    audienceSuitability: 'family' as const,
    audienceFit: 'broad' as const,
    adultContent: false,
    audienceScope: 'global' as const,
    contentFlags: [],
  }

  it('inherits omitted child metadata and keeps explicit overrides', () => {
    expect(resolveInheritedQuestionMetadata(parent, {
      categories: ['Arts & Literature'],
      editorialDifficulty: 4,
      audienceSuitability: 'adult',
      audienceFit: 'young_adults',
      adultContent: true,
      audienceScope: 'country_specific',
      audienceLocale: 'Australia',
    })).toMatchObject({
      categories: ['Arts & Literature'],
      tags: ['eclipses'],
      editorialDifficulty: 4,
      stability: 'stable',
      audienceSuitability: 'adult',
      audienceFit: 'young_adults',
      adultContent: true,
      audienceScope: 'country_specific',
      audienceLocale: 'Australia',
      contentFlags: [],
    })
  })

  it('derives the effective package range and most restrictive audience', () => {
    expect(deriveQuestionPackageMetadata({
      question: parent,
      parts: [
        {},
        { categories: ['History'], editorialDifficulty: 4 },
        { categories: ['Sport'] },
      ],
      bonus: {
        categories: ['Arts & Literature'],
        audienceSuitability: 'adult',
        audienceFit: 'older_adults',
        adultContent: true,
        audienceScope: 'country_specific',
        audienceLocale: 'Australia',
        contentFlags: ['violence'],
      },
    })).toEqual({
      categories: ['Science & Nature', 'History', 'Sport', 'Arts & Literature'],
      tags: ['eclipses'],
      difficultyMin: 2,
      difficultyMax: 4,
      audienceSuitability: 'adult',
      audienceFits: ['broad', 'older_adults'],
      adultContent: true,
      audienceScope: 'country_specific',
      audienceLocales: ['Australia'],
      contentFlags: ['violence'],
    })
  })

  it('adds Part tags but replaces parent tags for a populated Bonus', () => {
    expect(deriveQuestionPackageMetadata({
      question: { tags: ['Space', 'Physics'] },
      parts: [{ tags: ['Eclipses'] }],
      bonus: { tags: ['Books', 'Twilight'], tagMode: 'replace' },
    }).tags).toEqual(['Space', 'Physics', 'Eclipses', 'Books', 'Twilight'])

    expect(resolveInheritedQuestionMetadata(parent, { tags: [], tagMode: 'replace' }).tags).toEqual([])
  })
})
