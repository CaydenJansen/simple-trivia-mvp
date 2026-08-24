import { describe, expect, it } from 'vitest'

import { groupQuestionQuizUsage, questionQuizUsageRowsFromDatabase, questionQuizUsageSummary } from './question-usage'

describe('question quiz usage', () => {
  it('normalizes quiz relationship rows and ignores missing provenance', () => {
    expect(questionQuizUsageRowsFromDatabase([
      { source_question_id: 'question-1', quiz_id: 'quiz-1', quiz: { title: 'Quiz 101', updated_at: '2026-08-20T00:00:00Z' } },
      { source_question_id: null, quiz_id: 'quiz-2', quiz: { title: 'Quiz 102', updated_at: '2026-08-21T00:00:00Z' } },
    ])).toEqual([
      { sourceQuestionId: 'question-1', quizId: 'quiz-1', quizTitle: 'Quiz 101', quizUpdatedAt: '2026-08-20T00:00:00Z' },
    ])
  })

  it('groups usage by source question and deduplicates repeated quiz copies', () => {
    expect(groupQuestionQuizUsage([
      { sourceQuestionId: 'question-1', quizId: 'quiz-1', quizTitle: 'Quiz 101', quizUpdatedAt: '2026-08-20T00:00:00Z' },
      { sourceQuestionId: 'question-1', quizId: 'quiz-1', quizTitle: 'Quiz 101', quizUpdatedAt: '2026-08-20T00:00:00Z' },
      { sourceQuestionId: 'question-1', quizId: 'quiz-2', quizTitle: 'Quiz 103', quizUpdatedAt: '2026-08-22T00:00:00Z' },
    ])).toEqual({
      'question-1': [
        { quizId: 'quiz-2', quizTitle: 'Quiz 103', quizUpdatedAt: '2026-08-22T00:00:00Z' },
        { quizId: 'quiz-1', quizTitle: 'Quiz 101', quizUpdatedAt: '2026-08-20T00:00:00Z' },
      ],
    })
  })

  it('summarizes fresh, single, and repeated usage compactly', () => {
    const usages = [
      { quizId: 'quiz-3', quizTitle: 'Quiz 103', quizUpdatedAt: '2026-08-23T00:00:00Z' },
      { quizId: 'quiz-2', quizTitle: 'Quiz 102', quizUpdatedAt: '2026-08-22T00:00:00Z' },
      { quizId: 'quiz-1', quizTitle: 'Quiz 101', quizUpdatedAt: '2026-08-21T00:00:00Z' },
    ]

    expect(questionQuizUsageSummary([])).toBe('Not used in any of your quizzes')
    expect(questionQuizUsageSummary(usages.slice(0, 1))).toBe('Quiz 103')
    expect(questionQuizUsageSummary(usages.slice(0, 2))).toBe('Quiz 103 and Quiz 102')
    expect(questionQuizUsageSummary(usages)).toBe('Quiz 103, Quiz 102 +1 more')
    expect(questionQuizUsageSummary([
      { quizId: 'quiz-2', quizTitle: 'Auto-Built Quiz', quizUpdatedAt: '2026-08-22T00:00:00Z' },
      { quizId: 'quiz-1', quizTitle: 'Auto-Built Quiz', quizUpdatedAt: '2026-08-21T00:00:00Z' },
    ])).toBe('Auto-Built Quiz (2 quizzes)')
  })
})
