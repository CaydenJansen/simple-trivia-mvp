import { describe, expect, it } from 'vitest'
import { answerCorrectnessSummaries, correctAnswerIndex, correctnessSummary } from './correctness-rate'
import { buildSubmissionGrading } from './grading'

describe('revealed answer correctness percentage', () => {
  it('counts multi-answer responses by expected answer rather than typed position', () => {
    const question = { question_type: 'multi-answer', correct_answer: ['Mercury', 'Venus'], accepted_answers: [[], ['Evening star']], points_max: 2, options: null }
    const rows = ['Venus', 'Evening star'].map(value => buildSubmissionGrading(question, JSON.stringify([value])))
    expect(answerCorrectnessSummaries('multi-answer', question.correct_answer, 2, rows).map(item => item.percentage)).toEqual([0, 100])
    expect(correctAnswerIndex(question.correct_answer, rows[0].items[0])).toBe(1)
    expect(correctAnswerIndex(question.correct_answer, { status: 'incorrect' })).toBe(-1)
  })
  it('keeps ranking and multipart answers positional', () => {
    for (const type of ['ranking', 'multi-part']) {
      expect(answerCorrectnessSummaries(type, ['A', 'B'], 2, [{ items: [{ status: 'correct' }, { status: 'incorrect' }] }]).map(item => item.percentage)).toEqual([50, 0])
    }
  })
  it('uses every joined team as the denominator', () => {
    expect(correctnessSummary(10, [
      ...Array.from({ length: 7 }, () => ({ is_correct: true as const })),
      { is_correct: false },
      { is_correct: null },
    ])).toEqual({ correct: 7, total: 10, percentage: 70 })
  })

  it('rounds to the nearest whole percentage', () => {
    expect(correctnessSummary(3, [
      { is_correct: true },
      { is_correct: true },
      { is_correct: false },
    ])).toEqual({ correct: 2, total: 3, percentage: 67 })
  })

  it('handles a game with no teams', () => {
    expect(correctnessSummary(0, [])).toEqual({ correct: 0, total: 0, percentage: 0 })
  })

  it('does not let stale duplicate rows inflate the result', () => {
    expect(correctnessSummary(1, [{ is_correct: true }, { is_correct: true }]))
      .toEqual({ correct: 1, total: 1, percentage: 100 })
  })
})
