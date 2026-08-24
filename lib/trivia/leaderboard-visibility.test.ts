import { describe, expect, it } from 'vitest'
import {
  leaderboardVisibilityFromSettings,
  playersSeeFinalLeaderboard,
  playersSeeLiveLeaderboard,
  roundResultsScreen,
} from './leaderboard-visibility'

describe('leaderboard visibility', () => {
  it('shows round standings only for always and end-of-round modes', () => {
    expect(roundResultsScreen('always')).toBe('round-results')
    expect(roundResultsScreen('round')).toBe('round-results')
    expect(roundResultsScreen('final')).toBe('round-results-hidden')
    expect(roundResultsScreen('host')).toBe('round-results-hidden')
  })

  it('keeps final standings private only in host-only mode', () => {
    expect(playersSeeFinalLeaderboard('always')).toBe(true)
    expect(playersSeeFinalLeaderboard('round')).toBe(true)
    expect(playersSeeFinalLeaderboard('final')).toBe(true)
    expect(playersSeeFinalLeaderboard('host')).toBe(false)
  })

  it('shows live standings throughout play only in always-show mode', () => {
    expect(playersSeeLiveLeaderboard('always')).toBe(true)
    expect(playersSeeLiveLeaderboard('round')).toBe(false)
    expect(playersSeeLiveLeaderboard('final')).toBe(false)
    expect(playersSeeLiveLeaderboard('host')).toBe(false)
  })

  it('defaults old or malformed settings to end-of-round visibility', () => {
    expect(leaderboardVisibilityFromSettings(null)).toBe('round')
    expect(leaderboardVisibilityFromSettings({})).toBe('round')
    expect(leaderboardVisibilityFromSettings({ leaderboard_visibility: 'unexpected' })).toBe('round')
    expect(leaderboardVisibilityFromSettings({ leaderboard_visibility: 'final' })).toBe('final')
  })
})
