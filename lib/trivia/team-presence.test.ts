import { describe, expect, it } from 'vitest'
import { isTeamDormant, TEAM_DORMANT_AFTER_MS } from './team-presence'

describe('team presence', () => {
  const now = Date.parse('2026-08-27T12:00:00.000Z')

  it('keeps a recently seen team active', () => {
    expect(isTeamDormant(new Date(now - TEAM_DORMANT_AFTER_MS + 1).toISOString(), now)).toBe(false)
  })

  it('puts a team to sleep after five minutes', () => {
    expect(isTeamDormant(new Date(now - TEAM_DORMANT_AFTER_MS).toISOString(), now)).toBe(true)
  })

  it('treats missing or invalid presence as dormant', () => {
    expect(isTeamDormant(null, now)).toBe(true)
    expect(isTeamDormant('not-a-date', now)).toBe(true)
  })
})

