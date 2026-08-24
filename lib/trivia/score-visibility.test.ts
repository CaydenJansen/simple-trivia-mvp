import { describe, expect, it } from 'vitest'
import { playersSeeScoresFromSettings } from './score-visibility'

describe('player score visibility', () => {
  it('keeps scores visible for existing games without the setting', () => {
    expect(playersSeeScoresFromSettings(null)).toBe(true)
    expect(playersSeeScoresFromSettings({})).toBe(true)
  })

  it('honours the host score visibility choice', () => {
    expect(playersSeeScoresFromSettings({ scores_visible_to_players: true })).toBe(true)
    expect(playersSeeScoresFromSettings({ scores_visible_to_players: false })).toBe(false)
  })

  it('does not hide scores for malformed legacy values', () => {
    expect(playersSeeScoresFromSettings({ scores_visible_to_players: 'false' })).toBe(true)
  })
})
