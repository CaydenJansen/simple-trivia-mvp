import { describe, expect, it } from 'vitest'
import { playerScoreVisibilityFromSettings, playersSeeScoresFromSettings, playersSeeScoresOnScreen } from './score-visibility'

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

  it('supports all stable pre-game visibility modes', () => {
    expect(playerScoreVisibilityFromSettings({ player_score_visibility: 'live' })).toBe('live')
    expect(playerScoreVisibilityFromSettings({ player_score_visibility: 'round' })).toBe('round')
    expect(playerScoreVisibilityFromSettings({ player_score_visibility: 'final' })).toBe('final')
    expect(playerScoreVisibilityFromSettings({ player_score_visibility: 'hidden' })).toBe('hidden')
  })

  it('shows round-finalized scores only on checkpoint screens', () => {
    const settings = { player_score_visibility: 'round' }
    expect(playersSeeScoresOnScreen(settings, 'single-answer')).toBe(false)
    expect(playersSeeScoresOnScreen(settings, 'round-results')).toBe(false)
    expect(playersSeeScoresOnScreen(settings, 'round-results', true)).toBe(true)
    expect(playersSeeScoresOnScreen(settings, 'final-result')).toBe(true)
  })
})
