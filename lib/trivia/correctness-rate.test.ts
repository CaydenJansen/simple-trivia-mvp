import { describe, expect, it } from 'vitest'
import { correctnessSummary } from './correctness-rate'

describe('revealed answer correctness percentage', () => {
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
