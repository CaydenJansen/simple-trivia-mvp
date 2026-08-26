import { describe, expect, it } from 'vitest'
import {
  buildBonusGrading,
  buildConfidentBonusRevealResults,
  buildBonusRevealResults,
  runtimeBonusFromJson,
} from './bonus-grading'

const bonus = {
  prompt: 'What is the capital of Canada?',
  correct_answer: 'Ottawa',
  accepted_answers: ['Ottawa City'],
  points: 2,
  image_url: null,
}

describe('bonus grading', () => {
  it('hydrates a valid frozen bonus snapshot', () => {
    expect(runtimeBonusFromJson(bonus)).toEqual({
      prompt: bonus.prompt,
      correctAnswer: 'Ottawa',
      acceptedAnswers: ['Ottawa City'],
      points: 2,
      imageUrl: null,
    })
  })

  it('accepts a configured alias', () => {
    const runtime = runtimeBonusFromJson(bonus)!
    expect(buildBonusGrading(runtime, '  ottawa city! ').items[0]?.status).toBe('correct')
  })

  it('accepts a primary answer stored with legacy acceptance prose', () => {
    const runtime = runtimeBonusFromJson({
      ...bonus,
      correct_answer: 'Lady Gaga (we’ll also accept her real name)',
    })!
    expect(buildBonusGrading(runtime, 'Lady Gaga').items[0]?.status).toBe('correct')
  })

  it('keeps a one-edit typo reviewable', () => {
    const runtime = runtimeBonusFromJson(bonus)!
    expect(buildBonusGrading(runtime, 'Ottowa').items[0]?.status).toBe('review')
  })

  it('keeps reordered letters reviewable and explains why', () => {
    const runtime = runtimeBonusFromJson(bonus)!
    expect(buildBonusGrading(runtime, 'awatot').items[0]).toMatchObject({
      status: 'review',
      review_reason: 'same_characters',
    })
  })

  it('awards the bonus value only for a correct submission', () => {
    const runtime = runtimeBonusFromJson(bonus)!
    const results = buildBonusRevealResults(runtime, [
      { id: 'correct', answer_text: 'Ottawa', is_correct: null, grading_json: null },
      { id: 'wrong', answer_text: 'Toronto', is_correct: null, grading_json: null },
    ])
    expect(results.map(result => result.points_awarded)).toEqual([2, 0])
  })

  it('does not rescore an already finalized submission', () => {
    const runtime = runtimeBonusFromJson(bonus)!
    expect(buildBonusRevealResults(runtime, [
      { id: 'done', answer_text: 'Ottawa', is_correct: true, grading_json: null },
    ])).toEqual([])
  })

  it('leaves a reviewable bonus unresolved during Auto-Run', () => {
    const runtime = runtimeBonusFromJson(bonus)!
    expect(buildConfidentBonusRevealResults(runtime, [
      { id: 'review', answer_text: 'Ottowa', is_correct: null, grading_json: null },
    ])).toEqual([])
  })
})
