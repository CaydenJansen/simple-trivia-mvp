import { describe, expect, it } from 'vitest'

import { playersSeeCorrectnessPercentage } from './correctness-visibility'

describe('player correctness-percentage visibility', () => {
  it('is hidden by default', () => {
    expect(playersSeeCorrectnessPercentage(null)).toBe(false)
    expect(playersSeeCorrectnessPercentage({})).toBe(false)
  })

  it('is shown only when the host explicitly enables it', () => {
    expect(playersSeeCorrectnessPercentage({ show_correctness_percentage_to_players: true })).toBe(true)
    expect(playersSeeCorrectnessPercentage({ show_correctness_percentage_to_players: false })).toBe(false)
  })
})
