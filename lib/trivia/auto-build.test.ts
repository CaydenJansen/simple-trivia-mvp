import { describe, expect, it } from 'vitest'
import {
  autoBuildSizeSummary,
  buildAutoQuizPlan,
  distributeQuestionCount,
  getAutoBuildAvailability,
  getEligibleAutoBuildTiebreakers,
  matchesAutoBuildVibe,
  type AutoBuildContentSettings,
} from './auto-build'

const questions = [
  ...Array.from({ length: 8 }, (_, index) => ({ id: `music-${index}`, category: 'Music', difficulty: 'Easy' })),
  ...Array.from({ length: 8 }, (_, index) => ({ id: `sport-${index}`, category: 'Sport', difficulty: 'Medium' })),
  ...Array.from({ length: 8 }, (_, index) => ({ id: `movies-${index}`, category: 'Movies', difficulty: 'Hard' })),
]
const tiebreakers = Array.from({ length: 5 }, (_, index) => ({ id: `tie-${index}` }))
const noShuffle = () => 0.999999
const familyAustraliaSettings: AutoBuildContentSettings = {
  audienceFit: 'kids',
  allowAdultContent: false,
  scopeMode: 'include_locale',
  locale: 'Australia',
}
const allAudienceSettings: AutoBuildContentSettings = {
  audienceFit: 'all',
  allowAdultContent: false,
  scopeMode: 'global_only',
  locale: '',
}
const expandedQuestions = ['General Knowledge', 'Movies', 'Sport', 'Music'].flatMap(category => (
  ['Hard', 'Very Hard'].flatMap(difficulty => (
    Array.from({ length: 6 }, (_, index) => ({ id: `${category}-${difficulty}-${index}`, category, difficulty }))
  ))
))

describe('Auto-Build selection semantics', () => {
  it('distributes 30 questions across four rounds without changing the total', () => {
    expect(distributeQuestionCount(30, 4)).toEqual([8, 8, 7, 7])
  })

  it('uses an exact per-round count when every round is the same size', () => {
    expect(autoBuildSizeSummary(20, 4)).toBe('About 48 minutes, with 5 questions per round.')
  })

  it('uses a rough range only when round sizes differ', () => {
    expect(autoBuildSizeSummary(30, 4)).toBe('About 72 minutes, with roughly 7–8 questions per round.')
  })

  it('includes three minutes for every generated show game', () => {
    expect(autoBuildSizeSummary(20, 4, 4)).toBe('About 60 minutes, with 5 questions per round.')
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

  it('excludes adult content and country-specific content outside the requested locale', () => {
    const filteredQuestions = [
      { id: 'global-safe', category: 'Music', difficulty: 'Easy', audience_fit: 'broad' as const, adult_content: false, audience_scope: 'global' as const, audience_locale: null },
      { id: 'australia-safe', category: 'Music', difficulty: 'Easy', audience_fit: 'kids' as const, adult_content: false, audience_scope: 'country_specific' as const, audience_locale: 'Australia' },
      { id: 'uk-safe', category: 'Music', difficulty: 'Easy', audience_fit: 'kids' as const, adult_content: false, audience_scope: 'country_specific' as const, audience_locale: 'United Kingdom' },
      { id: 'global-adult', category: 'Music', difficulty: 'Easy', audience_fit: 'broad' as const, adult_content: true, audience_scope: 'global' as const, audience_locale: null },
    ]

    const plan = buildAutoQuizPlan({
      questions: filteredQuestions,
      tiebreakers: [
        { id: 'tie-1', adult_content: false, audience_scope: 'global' as const },
        { id: 'tie-2', adult_content: false, audience_scope: 'global' as const },
        { id: 'tie-3', adult_content: false, audience_scope: 'country_specific' as const, audience_locale: 'Australia' },
      ],
      questionCount: 2,
      roundTopics: ['Music'],
      difficulties: ['Easy'],
      contentSettings: familyAustraliaSettings,
      random: noShuffle,
    })

    expect(plan.rounds[0].questions.map(question => question.id).sort()).toEqual(['australia-safe', 'global-safe'])
  })

  it('treats audience fit as a preference rather than a hard requirement', () => {
    const plan = buildAutoQuizPlan({
      questions: [
        { id: 'broad', category: 'Music', difficulty: 'Easy', audience_fit: 'broad' as const },
        { id: 'kids', category: 'Music', difficulty: 'Easy', audience_fit: 'kids' as const },
      ],
      tiebreakers,
      questionCount: 2,
      roundTopics: ['Music'],
      difficulties: ['Easy'],
      contentSettings: familyAustraliaSettings,
      random: noShuffle,
    })

    expect(plan.rounds[0].questions.map(question => question.id)).toEqual(['kids', 'broad'])
  })

  it('does not prefer or exclude any audience fit when all audience fits are selected', () => {
    const plan = buildAutoQuizPlan({
      questions: [
        { id: 'kids', category: 'Music', difficulty: 'Easy', audience_fit: 'kids' as const },
        { id: 'older-adults', category: 'Music', difficulty: 'Easy', audience_fit: 'older_adults' as const },
        { id: 'broad', category: 'Music', difficulty: 'Easy', audience_fit: 'broad' as const },
      ],
      tiebreakers,
      questionCount: 3,
      roundTopics: ['Music'],
      difficulties: ['Easy'],
      contentSettings: allAudienceSettings,
      random: noShuffle,
    })

    expect(plan.rounds[0].questions.map(question => question.id)).toEqual(['kids', 'older-adults', 'broad'])
  })

  it('filters the guys-wearing-hats vibe to blokey and sporting topics without restricting tiebreakers', () => {
    const settings = { ...allAudienceSettings, vibe: 'guys_wearing_hats' as const }
    const availability = getAutoBuildAvailability({
      questions: [
        { id: 'sport', category: 'Sport', difficulty: 'Easy', tags: [] },
        { id: 'cars', category: 'General Knowledge', difficulty: 'Easy', tags: ['Cars'] },
        { id: 'poetry', category: 'Literature', difficulty: 'Easy', tags: ['Poetry'] },
      ],
      questionCount: 2,
      roundTopics: ['General Knowledge'],
      difficulties: ['Easy'],
      contentSettings: settings,
    })

    expect(availability).toMatchObject({ canBuild: true, matchingQuestionCount: 2 })
    expect(getEligibleAutoBuildTiebreakers(tiebreakers, settings)).toHaveLength(5)
  })

  it('filters the butterfly vibe to whimsical subject matter', () => {
    expect(matchesAutoBuildVibe({ category: 'Science & Nature', tags: ['Animals'], prompt: 'Which tiny animal glows?' }, 'oh_look_a_butterfly')).toBe(true)
    expect(matchesAutoBuildVibe({ category: 'Literature', tags: ['Poetry'], prompt: 'Name this poem.' }, 'oh_look_a_butterfly')).toBe(true)
    expect(matchesAutoBuildVibe({ category: 'Sport', tags: ['Combat Sports'], prompt: 'Who won this bout?' }, 'oh_look_a_butterfly')).toBe(false)
  })

  it('applies adult-content and locale rules to prepared tiebreakers', () => {
    const eligible = getEligibleAutoBuildTiebreakers([
      { id: 'global', adult_content: false, audience_scope: 'global' },
      { id: 'australia', adult_content: false, audience_scope: 'country_specific', audience_locale: 'Australia' },
      { id: 'uk', adult_content: false, audience_scope: 'country_specific', audience_locale: 'United Kingdom' },
      { id: 'adult', adult_content: true, audience_scope: 'global' },
    ], familyAustraliaSettings)

    expect(eligible.map(tiebreaker => tiebreaker.id)).toEqual(['global', 'australia'])
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

  it('always includes exactly two prepared tiebreakers', () => {
    const plan = buildAutoQuizPlan({
      questions,
      tiebreakers,
      questionCount: 4,
      roundTopics: [null],
      difficulties: ['Easy'],
      random: noShuffle,
    })

    expect(plan.tiebreakers).toHaveLength(2)
  })

  it('can build without a prepared tiebreaker when the host opts out', () => {
    const plan = buildAutoQuizPlan({
      questions,
      tiebreakers: [],
      tiebreakerCount: 0,
      questionCount: 4,
      roundTopics: [null],
      difficulties: ['Easy'],
      random: noShuffle,
    })

    expect(plan.tiebreakers).toEqual([])
  })

  it('selects one source tiebreaker for the default in-show mode', () => {
    const plan = buildAutoQuizPlan({
      questions,
      tiebreakers,
      tiebreakerCount: 1,
      questionCount: 4,
      roundTopics: [null],
      difficulties: ['Easy'],
      random: noShuffle,
    })

    expect(plan.tiebreakers).toHaveLength(1)
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
      tiebreakers: tiebreakers.slice(0, 1),
      questionCount: 1,
      roundTopics: [null],
      difficulties: ['Easy'],
      random: noShuffle,
    })).toThrow('Auto-Build needs at least 2 active prepared tiebreakers.')
  })
})
