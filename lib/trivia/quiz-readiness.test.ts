import { describe, expect, it } from 'vitest'
import { checkQuizReadiness, quizCanHost, quizStatusFromReadiness } from './quiz-readiness'

function readyQuiz() {
  return {
    title: 'Friday Night Trivia',
    rounds: [{ questionCount: 2, contentScreenTitles: ['Welcome'], pointGameCount: 0 }],
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
      rounds: [{ questionCount: 0, contentScreenTitles: [''], pointGameCount: 0 }],
      tiebreakers: [{ prompt: '', correctValue: 'ten' }],
    })

    expect(result.ready).toBe(false)
    expect(result.blockers).toEqual([
      'Add a quiz title.',
      'Add at least one scored question or points game.',
      'Give every content screen a title.',
      'Finish or remove every incomplete tiebreaker question.',
      'Give every tiebreaker a numeric correct answer, without words or units.',
    ])
  })

  it('allows a show made only from points games', () => {
    const result = checkQuizReadiness({
      title: 'Games Night',
      rounds: [{ questionCount: 0, contentScreenTitles: ['Welcome'], pointGameCount: 2 }],
      tiebreakers: [],
    })

    expect(result.ready).toBe(true)
    expect(result.blockers).toEqual([])
  })

  it('does not count custom-prize games as scored content', () => {
    const result = checkQuizReadiness({
      title: 'Prize Night',
      rounds: [{ questionCount: 0, contentScreenTitles: [], pointGameCount: 0 }],
      tiebreakers: [],
    })

    expect(result.blockers).toContain('Add at least one scored question or points game.')
  })

  it('recommends two tiebreakers without blocking readiness', () => {
    const result = checkQuizReadiness({ ...readyQuiz(), tiebreakers: [] })

    expect(result.ready).toBe(true)
    expect(result.warnings).toEqual([
      'Only 0 prepared tiebreakers. We recommend at least 2, but you can continue without them.',
    ])
  })

  it('automatically derives Draft or Ready from current content', () => {
    expect(quizStatusFromReadiness({ ready: true })).toBe('ready')
    expect(quizStatusFromReadiness({ ready: false })).toBe('draft')
  })

  it('only hosts the exact saved and complete quiz version', () => {
    expect(quizCanHost({ persisted: true, dirty: false, ready: true, status: 'ready' })).toBe(true)
    expect(quizCanHost({ persisted: false, dirty: true, ready: true, status: 'draft' })).toBe(false)
    expect(quizCanHost({ persisted: true, dirty: true, ready: true, status: 'ready' })).toBe(false)
    expect(quizCanHost({ persisted: true, dirty: false, ready: true, status: 'draft' })).toBe(false)
    expect(quizCanHost({ persisted: true, dirty: false, ready: false, status: 'draft' })).toBe(false)
  })
})
