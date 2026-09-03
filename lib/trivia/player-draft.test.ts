import { describe, expect, it } from 'vitest'

import { savedAnswerForQuestion } from './player-draft'

describe('player draft restoration', () => {
  it('restores a saved answer only for the question that owns it', () => {
    expect(savedAnswerForQuestion('q1', 'q1', 'Brisbane')).toBe('Brisbane')
    expect(savedAnswerForQuestion('q2', 'q1', 'Brisbane')).toBeNull()
  })

  it('does not expose a previous answer while the next question is hydrating', () => {
    expect(savedAnswerForQuestion('q2', 'q1', ['old', 'answers'])).toBeNull()
    expect(savedAnswerForQuestion(undefined, 'q1', 'old answer')).toBeNull()
  })
})
