import { describe, expect, it } from 'vitest'
import { bombDangerWindowSeconds, bombIsOvertime, bombPhase, lowestUniqueBid, sharedCursorStamina, sharedCursorState } from './collaborative-show-games'

describe('collaborative show-game state', () => {
  it('parses shared cursor positions defensively', () => {
    expect(sharedCursorState({ cursor_x: 0.25, cursor_y: -0.5, cursor_candidate_id: 'team-a', cursor_candidate_since_ms: 123, cursor_positions: { 'team-a': { x: 1, y: 0 }, broken: { x: 'nope', y: 1 } } })).toEqual({
      x: 0.25, y: -0.5, candidateTeamId: 'team-a', candidateSince: 123, positions: { 'team-a': { x: 1, y: 0 } },
    })
  })

  it('keeps the bomb locked until its server arming timestamp', () => {
    expect(bombPhase({ armed_at: '2026-09-13T00:00:20.000Z' }, Date.parse('2026-09-13T00:00:05.000Z'))).toEqual({ armed: false, seconds: 15 })
    expect(bombPhase({ armed_at: '2026-09-13T00:00:20.000Z' }, Date.parse('2026-09-13T00:00:20.000Z'))).toEqual({ armed: true, seconds: 0 })
    expect(bombDangerWindowSeconds({ armed_at: '2026-09-13T00:00:20.000Z' }, Date.parse('2026-09-13T00:00:35.000Z'))).toBe(45)
  })

  it('uses the configured bomb deadline and exposes overtime', () => {
    expect(bombDangerWindowSeconds({ armed_at: '2026-09-13T00:00:20.000Z', danger_ends_at: '2026-09-13T00:01:20.000Z' }, Date.parse('2026-09-13T00:01:05.000Z'))).toBe(15)
    expect(bombIsOvertime({ overtime: true })).toBe(true)
    expect(bombIsOvertime({ overtime: false })).toBe(false)
  })

  it('finds only the lowest bid that nobody duplicated', () => {
    const bids = [{ team_id: 'a', bid: 1 }, { team_id: 'b', bid: 1 }, { team_id: 'c', bid: 2 }, { team_id: 'd', bid: 4 }]
    expect(lowestUniqueBid(bids)).toEqual({ team_id: 'c', bid: 2 })
    expect(lowestUniqueBid([{ bid: 3 }, { bid: 3 }])).toBeNull()
  })

  it('recovers shared cursor stamina and enforces the cooldown window', () => {
    const settings = { cursor_stamina: { 'team-a': { remaining: 2, updated_at_ms: 1_000, cooldown_until_ms: null } } }
    expect(sharedCursorStamina(settings, 'team-a', 3_100)).toMatchObject({ remaining: 4, percent: 80, coolingDown: false })
    const cooling = { cursor_stamina: { 'team-a': { remaining: 0, updated_at_ms: 1_000, cooldown_until_ms: 4_000 } } }
    expect(sharedCursorStamina(cooling, 'team-a', 2_100)).toMatchObject({ remaining: 0, percent: 0, coolingDown: true, cooldownSeconds: 2 })
    expect(sharedCursorStamina(cooling, 'team-a', 4_100)).toMatchObject({ remaining: 5, percent: 100, coolingDown: false })
  })
})
