import { describe, expect, it } from 'vitest'
import { checkQuizReadiness } from './quiz-readiness'

function readyQuiz() {
  return {
    title: 'Friday Night Trivia',
    rounds: [{ questionCount: 2, contentScreenTitles: ['Welcome'] }],
    tiebreakers: [
      { prompt: 'How many kilometres?', correctValue: '100' },
      { prompt: 'How many years?', correctValue: '25' },
    ],
  }
}

describe('quiz readiness', () => {
  it('allows a complete quiz to be marked ready', () => {
    expect(checkQuizReadiness(readyQuiz())).toEqual({ blockers: [], warnings: [], ready: true })
  })

  it('blocks hosting when required quiz content is missing', () => {
    const result = checkQuizReadiness({
      title: ' ',
      rounds: [{ questionCount: 0, contentScreenTitles: [''] }],
      tiebreakers: [{ prompt: '', correctValue: 'ten' }],
    })

    expect(result.ready).toBe(false)
    expect(result.blockers).toEqual([
      'Add a quiz title.',
      'Add at least one scored question.',
      'Each round with a content screen needs at least one scored question.',
      'Give every content screen a title.',
      'Finish or remove every incomplete tiebreaker question.',
      'Give every tiebreaker a numeric correct answer, without words or units.',
    ])
  })

  it('recommends two tiebreakers without blocking readiness', () => {
    const result = checkQuizReadiness({ ...readyQuiz(), tiebreakers: [] })

    expect(result.ready).toBe(true)
    expect(result.warnings).toEqual([
      'Only 0 prepared tiebreakers. We recommend at least 2, but you can continue without them.',
    ])
  })
})
