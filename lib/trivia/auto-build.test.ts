import { describe, expect, it } from 'vitest'
import { buildAutoQuizPlan, distributeQuestionCount, getAutoBuildAvailability } from './auto-build'

const questions = [
  ...Array.from({ length: 8 }, (_, index) => ({ id: `music-${index}`, category: 'Music', difficulty: 'Easy' })),
  ...Array.from({ length: 8 }, (_, index) => ({ id: `sport-${index}`, category: 'Sport', difficulty: 'Medium' })),
  ...Array.from({ length: 8 }, (_, index) => ({ id: `movies-${index}`, category: 'Movies', difficulty: 'Hard' })),
]
const tiebreakers = Array.from({ length: 5 }, (_, index) => ({ id: `tie-${index}` }))
const noShuffle = () => 0.999999
const expandedQuestions = ['General Knowledge', 'Movies', 'Sport', 'Music'].flatMap(category => (
  ['Hard', 'Very Hard'].flatMap(difficulty => (
    Array.from({ length: 6 }, (_, index) => ({ id: `${category}-${difficulty}-${index}`, category, difficulty }))
  ))
))

describe('Auto-Build selection semantics', () => {
  it('distributes 30 questions across four rounds without changing the total', () => {
    expect(distributeQuestionCount(30, 4)).toEqual([8, 8, 7, 7])
  })

  it('requires at least one question in every configured round', () => {
    expect(() => buildAutoQuizPlan({
      questions,
      tiebreakers,
      questionCount: 2,
      roundTopics: [null, null, null],
      difficulties: ['Easy'],
    })).toThrow('Add at least one question for every round.')
  })

  it('treats a named General Knowledge round as a mixed-category round', () => {
    const availability = getAutoBuildAvailability({
      questions,
      questionCount: 6,
      roundTopics: ['General Knowledge'],
      difficulties: ['Easy', 'Medium', 'Hard'],
    })

    expect(availability.canBuild).toBe(true)
    expect(availability.matchingQuestionCount).toBe(24)
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

  it('reports shortages before generation and aggregates repeated topics', () => {
    const availability = getAutoBuildAvailability({
      questions,
      questionCount: 12,
      roundTopics: ['Music', 'Music'],
      difficulties: ['Easy'],
    })

    expect(availability).toEqual({
      canBuild: false,
      matchingQuestionCount: 8,
      shortages: [{ topic: 'Music', available: 8, required: 12 }],
    })
  })

  it('builds a complete 30-question mixed draft from a narrower range', () => {
    const plan = buildAutoQuizPlan({
      questions: expandedQuestions,
      tiebreakers,
      questionCount: 30,
      roundTopics: [null, null, null, null],
      difficulties: ['Hard', 'Very Hard'],
      random: noShuffle,
    })

    expect(plan.rounds.map(round => round.questions.length)).toEqual([8, 8, 7, 7])
    expect(new Set(plan.rounds.flatMap(round => round.questions.map(question => question.id))).size).toBe(30)
  })

  it('builds a complete 30-question custom-topic draft from a narrower range', () => {
    const topics = ['General Knowledge', 'Movies', 'Sport', 'Music']
    const plan = buildAutoQuizPlan({
      questions: expandedQuestions,
      tiebreakers,
      questionCount: 30,
      roundTopics: topics,
      difficulties: ['Hard', 'Very Hard'],
      random: noShuffle,
    })

    expect(plan.rounds.map(round => round.questions.length)).toEqual([8, 8, 7, 7])
    expect(plan.rounds.every(round => round.questions.every(question => question.category === round.title))).toBe(true)
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
    })).toThrow('Question Library has 8 matching questions for Music, but this quiz needs 9.')

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
