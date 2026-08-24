import { describe, expect, it } from 'vitest'

import {
  EMPTY_SOURCE_QUESTION_BONUS,
  estimatedQuizMinutes,
  sourceQuestionBonusDraft,
  sourceQuestionBonusPayload,
  validateSourceQuestionBonus,
} from './source-question-bonus'

describe('source question bonus authoring', () => {
  it('treats a missing bonus as disabled', () => {
    expect(sourceQuestionBonusDraft(null)).toEqual(EMPTY_SOURCE_QUESTION_BONUS)
    expect(sourceQuestionBonusPayload(EMPTY_SOURCE_QUESTION_BONUS)).toBeNull()
  })

  it('requires content and positive whole-number points when enabled', () => {
    expect(validateSourceQuestionBonus({ ...EMPTY_SOURCE_QUESTION_BONUS, enabled: true })).toBe('Add the bonus question text.')
    expect(validateSourceQuestionBonus({ ...EMPTY_SOURCE_QUESTION_BONUS, enabled: true, prompt: 'Bonus?' })).toBe('Add the bonus answer.')
    expect(validateSourceQuestionBonus({ ...EMPTY_SOURCE_QUESTION_BONUS, enabled: true, prompt: 'Bonus?', answer: 'Yes', points: 0 })).toContain('greater than zero')
    expect(validateSourceQuestionBonus({ ...EMPTY_SOURCE_QUESTION_BONUS, enabled: true, prompt: 'Bonus?', answer: 'Yes', points: 1.5 })).toContain('whole number')
  })

  it('serializes an independent bonus with aliases, points, media, and metadata', () => {
    expect(sourceQuestionBonusPayload({
      ...EMPTY_SOURCE_QUESTION_BONUS,
      enabled: true,
      prompt: '  Name the bonus city. ',
      answer: ' Brisbane ',
      aliases: 'Brissie, BNE',
      points: 2,
      imageUrl: ' https://example.com/bonus.jpg ',
      primaryCategoryId: 'category-1',
      secondaryCategoryIds: ['category-2'],
      editorialDifficulty: 3,
      tagIds: ['tag-1'],
    })).toEqual({
      prompt: 'Name the bonus city.',
      correct_answer: 'Brisbane',
      accepted_answers: ['Brissie', 'BNE'],
      points: 2,
      image_url: 'https://example.com/bonus.jpg',
      primary_category_id: 'category-1',
      secondary_category_ids: ['category-2'],
      editorial_difficulty: 3,
      tag_ids: ['tag-1'],
      prompt_pattern_id: null,
      answer_type_id: null,
      stability: null,
      audience_suitability: null,
      audience_scope: null,
      audience_locale: null,
      content_flags: null,
    })
  })

  it('hydrates a stored bonus for editing', () => {
    expect(sourceQuestionBonusDraft({
      prompt: 'Bonus?',
      correct_answer: 'Answer',
      accepted_answers: ['Alternative'],
      points: 3,
      image_url: null,
      primary_category_id: 'category-1',
      secondary_category_ids: [],
      editorial_difficulty: 5,
      tag_ids: ['tag-1'],
      prompt_pattern_id: null,
      answer_type_id: null,
      stability: 'review_periodically',
    })).toMatchObject({
      enabled: true,
      prompt: 'Bonus?',
      answer: 'Answer',
      aliases: 'Alternative',
      points: 3,
      editorialDifficulty: 5,
      stability: 'review_periodically',
    })
  })

  it('adds bonuses to runtime estimates without changing the normal question count', () => {
    const normalQuestionCount = 30
    expect(estimatedQuizMinutes(normalQuestionCount, 0)).toBe(72)
    expect(estimatedQuizMinutes(normalQuestionCount, 4)).toBe(82)
    expect(normalQuestionCount).toBe(30)
  })
})
