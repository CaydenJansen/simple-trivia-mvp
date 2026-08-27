import { describe, expect, it } from 'vitest'
import {
  BEAT_THE_BOMB_MAX_SECONDS,
  BEAT_THE_BOMB_MIN_SECONDS,
  beatTheBombWinner,
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
})
