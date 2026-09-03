import { describe, expect, it } from 'vitest'

import { initialRankingOrder } from './ranking-order'

describe('ranking starting order', () => {
  const correct = ['Mercury', 'Venus', 'Earth', 'Mars']

  it('never starts a playable ranker in the correct order', () => {
    for (let index = 0; index < 100; index += 1) {
      expect(initialRankingOrder(correct, correct, `question:team:${index}`)).not.toEqual(correct)
    }
  })

  it('is stable for the same question and team', () => {
    expect(initialRankingOrder(correct, correct, 'question:team'))
      .toEqual(initialRankingOrder(correct, correct, 'question:team'))
  })

  it('does not mutate authored options', () => {
    const options = [...correct]
    initialRankingOrder(options, correct, 'question:team')
    expect(options).toEqual(correct)
  })
})
