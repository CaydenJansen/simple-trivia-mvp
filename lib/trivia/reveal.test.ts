import { describe, expect, it } from 'vitest'
import type { GradingQuestion } from './grading'
import { buildRevealResults, type RevealSubmission } from './reveal'

const question: GradingQuestion = {
  question_type: 'single-answer',
  correct_answer: 'Canada',
  options: null,
  points_max: 1,
}

function submission(overrides: Partial<RevealSubmission>): RevealSubmission {
  return {
    id: 'submission-1',
    answer_text: 'Canada',
    grading_json: null,
    is_correct: null,
    ...overrides,
  }
}

describe('buildRevealResults', () => {
  it('uses the host review override when finalising a reviewable answer', () => {
    const results = buildRevealResults(question, [submission({
      answer_text: 'Cannada',
      grading_json: {
        items: [{ submitted: 'Cannada', expected: 'Canada', status: 'correct' }],
      },
    })])

    expect(results[0]).toMatchObject({
      submission_id: 'submission-1',
      is_correct: true,
      points_awarded: 1,
    })
  })

  it('does not send an already-scored submission for a second award', () => {
    expect(buildRevealResults(question, [submission({
      is_correct: true,
    })])).toEqual([])
  })
})
