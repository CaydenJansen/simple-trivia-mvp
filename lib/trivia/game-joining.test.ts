import { describe, expect, it } from 'vitest'

import { gameAcceptsNewTeams, JOINABLE_GAME_STATUSES } from './game-joining'

describe('live game joining', () => {
  it('allows teams to join in the lobby or during active play', () => {
    expect(JOINABLE_GAME_STATUSES).toEqual(['lobby', 'live'])
    expect(gameAcceptsNewTeams('lobby')).toBe(true)
    expect(gameAcceptsNewTeams('live')).toBe(true)
  })

  it('rejects completed, cancelled, or missing games', () => {
    expect(gameAcceptsNewTeams('finished')).toBe(false)
    expect(gameAcceptsNewTeams('cancelled')).toBe(false)
    expect(gameAcceptsNewTeams(null)).toBe(false)
  })
})
