import { describe, expect, it } from 'vitest'
import { parseSessionHealth, teamConnectionState } from './session-health'

describe('session health', () => {
  const now = Date.parse('2026-10-03T12:00:00Z')
  it('allows normal heartbeat gaps and does not call delayed teams disconnected', () => {
    expect(teamConnectionState(new Date(now - 90_000).toISOString(), now)).toBe('recent')
    expect(teamConnectionState(new Date(now - 101_000).toISOString(), now)).toBe('delayed')
    expect(teamConnectionState(new Date(now - 300_000).toISOString(), now)).toBe('asleep')
    expect(teamConnectionState(null, now)).toBe('asleep')
    expect(teamConnectionState('invalid', now)).toBe('asleep')
  })
  it('keeps unsent answers distinct from server-confirmed submissions', () => {
    const parsed = parseSessionHealth({ game_id: 'game', practice: true, teams: [null, { id: 'a', name: 'A', submitted: false }, { id: 'b', name: 'B', submitted: true }, { id: 'c', name: 'C', submitted: null }] })
    expect(parsed?.practice).toBe(true)
    expect(parsed?.teams.map(team => team.submitted)).toEqual([false, true, null])
    expect(parseSessionHealth(null)).toBeNull()
    expect(parseSessionHealth([])).toBeNull()
  })
})
