import { describe, expect, it } from 'vitest'

import { competitionPlacements, ordinalPlacement } from './leaderboard-ranking'

describe('ordinary leaderboard ties', () => {
  it('uses competition ranking without inventing an order between tied teams', () => {
    expect(competitionPlacements([
      { score: 6 },
      { score: 6 },
      { score: 4 },
      { score: 2 },
      { score: 2 },
    ])).toEqual([1, 1, 3, 4, 4])
  })

  it('formats placement labels including teen suffixes', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinalPlacement)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st',
    ])
  })
})
