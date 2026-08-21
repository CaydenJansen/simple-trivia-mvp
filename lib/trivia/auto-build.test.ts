import { describe, expect, it } from 'vitest'
import { buildAutoQuizPlan, distributeQuestionCount } from './auto-build'

const questions = [
  ...Array.from({ length: 8 }, (_, index) => ({ id: `music-${index}`, category: 'Music', difficulty: 'Easy' })),
  ...Array.from({ length: 8 }, (_, index) => ({ id: `sport-${index}`, category: 'Sport', difficulty: 'Medium' })),
  ...Array.from({ length: 8 }, (_, index) => ({ id: `movies-${index}`, category: 'Movies', difficulty: 'Hard' })),
]
const tiebreakers = Array.from({ length: 5 }, (_, index) => ({ id: `tie-${index}` }))
const noShuffle = () => 0.999999

describe('Auto-Build selection semantics', () => {
  it('distributes 30 questions across four rounds without changing the total', () => {
    expect(distributeQuestionCount(30, 4)).toEqual([8, 8, 7, 7])
  })

  it('selects custom round topics without reusing source questions', () => {
    const plan = buildAutoQuizPlan({
      questions,
      tiebreakers,
      questionCount: 12,
      roundTopics: ['Music', 'Sport', 'Movies'],
      difficulties: ['Easy', 'Medium', 'Hard'],
      random: noShuffle,
    })

    expect(plan.rounds.map(round => round.questions.length)).toEqual([4, 4, 4])
    expect(plan.rounds.map(round => round.questions.every(question => question.category === round.title))).toEqual([true, true, true])
    expect(new Set(plan.rounds.flatMap(round => round.questions.map(question => question.id))).size).toBe(12)
  })

  it('filters by the requested difficulty range', () => {
    const plan = buildAutoQuizPlan({
      questions,
      tiebreakers,
      questionCount: 4,
      roundTopics: [null],
      difficulties: ['Medium'],
      random: noShuffle,
    })

    expect(plan.rounds[0].questions.every(question => question.difficulty === 'Medium')).toBe(true)
  })

  it('supports the very easy and very hard endpoints', () => {
    const endpointQuestions = [
      { id: 'very-easy', category: 'General Knowledge', difficulty: 'Very Easy' },
      { id: 'very-hard', category: 'General Knowledge', difficulty: 'Very Hard' },
    ]
    const plan = buildAutoQuizPlan({
      questions: endpointQuestions,
      tiebreakers,
      questionCount: 2,
      roundTopics: [null],
      difficulties: ['Very Easy', 'Very Hard'],
      random: noShuffle,
    })

    expect(plan.rounds[0].questions.map(question => question.difficulty).sort()).toEqual(['Very Easy', 'Very Hard'])
  })

  it('always includes exactly three prepared tiebreakers', () => {
    const plan = buildAutoQuizPlan({
      questions,
      tiebreakers,
      questionCount: 4,
      roundTopics: [null],
      difficulties: ['Easy'],
      random: noShuffle,
    })

    expect(plan.tiebreakers).toHaveLength(3)
  })

  it('explains when a topic or the tiebreaker pool is too small', () => {
    expect(() => buildAutoQuizPlan({
      questions,
      tiebreakers,
      questionCount: 9,
      roundTopics: ['Music'],
      difficulties: ['Easy'],
      random: noShuffle,
    })).toThrow('Question Library has 8 matching questions for Music, but this round needs 9.')

    expect(() => buildAutoQuizPlan({
      questions,
      tiebreakers: tiebreakers.slice(0, 2),
      questionCount: 1,
      roundTopics: [null],
      difficulties: ['Easy'],
      random: noShuffle,
    })).toThrow('Auto-Build needs at least 3 active prepared tiebreakers.')
  })
})
