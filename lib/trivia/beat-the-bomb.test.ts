import { describe, expect, it } from 'vitest'
import {
  BEAT_THE_BOMB_MAX_SECONDS,
  BEAT_THE_BOMB_MIN_SECONDS,
  beatTheBombWinner,
  bombCutTimingSentence,
  secondsBeforeBombExplosion,
  shouldResolveBeatTheBomb,
} from './beat-the-bomb'

describe('Beat the Bomb semantics', () => {
  it('keeps the configured random fuse within 10–30 seconds', () => {
    expect(BEAT_THE_BOMB_MIN_SECONDS).toBe(10)
    expect(BEAT_THE_BOMB_MAX_SECONDS).toBe(30)
  })

  it('never resolves before at least one team presses', () => {
    expect(shouldResolveBeatTheBomb({ pressCount: 0, teamCount: 3, nowMs: 31_000, explodeAtMs: 30_000 })).toBe(false)
  })

  it('resolves when the fuse expires after a press', () => {
    expect(shouldResolveBeatTheBomb({ pressCount: 1, teamCount: 3, nowMs: 30_000, explodeAtMs: 30_000 })).toBe(true)
  })

  it('resolves immediately once every team has pressed', () => {
    expect(shouldResolveBeatTheBomb({ pressCount: 3, teamCount: 3, nowMs: 12_000, explodeAtMs: 30_000 })).toBe(true)
  })

  it('chooses the latest press without changing trivia score', () => {
    expect(beatTheBombWinner([
      { teamId: 'alpha', pressedAtMs: 1_000 },
      { teamId: 'bravo', pressedAtMs: 2_500 },
      { teamId: 'charlie', pressedAtMs: 2_000 },
    ])).toBe('bravo')
  })

  it('reports each cut relative to the authoritative explosion time', () => {
    expect(secondsBeforeBombExplosion('2026-09-23T08:00:46.000Z', '2026-09-23T08:01:00.000Z')).toBe(14)
    expect(bombCutTimingSentence('You', 14)).toBe('You cut the wire 14 seconds before the bomb exploded.')
    expect(bombCutTimingSentence('The winner', 1)).toBe('The winner cut the wire 1 second before the bomb exploded.')
    expect(bombCutTimingSentence('You', 0)).toBe('You cut the wire at the last possible moment.')
  })
})
