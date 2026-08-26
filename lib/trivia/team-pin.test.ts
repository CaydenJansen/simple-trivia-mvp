import { describe, expect, it } from 'vitest'

import {
  isValidTeamPin,
  normalizeTeamPin,
  TEAM_PIN_LENGTH,
  teamPinErrorMessage,
} from './team-pin'

describe('optional team PINs', () => {
  it('keeps four numeric digits and removes pasted formatting', () => {
    expect(TEAM_PIN_LENGTH).toBe(4)
    expect(normalizeTeamPin(' 48-21 ')).toBe('4821')
    expect(normalizeTeamPin('123456')).toBe('1234')
  })

  it('requires exactly four digits', () => {
    expect(isValidTeamPin('4821')).toBe(true)
    expect(isValidTeamPin('482')).toBe(false)
    expect(isValidTeamPin('48a1')).toBe(false)
  })

  it('turns database PIN failures into useful player guidance', () => {
    expect(teamPinErrorMessage('TEAM_PIN_NOT_FOUND')).toContain('team name and PIN')
    expect(teamPinErrorMessage('TEAM_PIN_ALREADY_EXISTS')).toContain('already have')
    expect(teamPinErrorMessage('TEAM_ALREADY_JOINED')).toContain('already joined')
    expect(teamPinErrorMessage('unrelated')).toBeNull()
  })
})
