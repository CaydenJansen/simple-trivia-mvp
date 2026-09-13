import { describe, expect, it } from 'vitest'
import { bombPhase, sharedCursorState } from './collaborative-show-games'

describe('collaborative show-game state', () => {
  it('parses shared cursor positions defensively', () => {
    expect(sharedCursorState({ cursor_x: 0.25, cursor_y: -0.5, cursor_candidate_id: 'team-a', cursor_candidate_since_ms: 123, cursor_positions: { 'team-a': { x: 1, y: 0 }, broken: { x: 'nope', y: 1 } } })).toEqual({
      x: 0.25, y: -0.5, candidateTeamId: 'team-a', candidateSince: 123, positions: { 'team-a': { x: 1, y: 0 } },
    })
  })

  it('keeps the bomb locked until its server arming timestamp', () => {
    expect(bombPhase({ armed_at: '2026-09-13T00:00:20.000Z' }, Date.parse('2026-09-13T00:00:05.000Z'))).toEqual({ armed: false, seconds: 15 })
    expect(bombPhase({ armed_at: '2026-09-13T00:00:20.000Z' }, Date.parse('2026-09-13T00:00:20.000Z'))).toEqual({ armed: true, seconds: 0 })
  })
})
