import { describe, expect, it } from 'vitest'
import {
  leaderboardVisibilityFromSettings,
  playersSeeFinalLeaderboard,
  roundResultsScreen,
  showsLeaderboardAfterQuestion,
} from './leaderboard-visibility'

describe('leaderboard visibility', () => {
  it('shows round standings for question and end-of-round modes', () => {
    expect(roundResultsScreen('question')).toBe('round-results')
    expect(roundResultsScreen('round')).toBe('round-results')
    expect(roundResultsScreen('final')).toBe('round-results-hidden')
    expect(roundResultsScreen('host')).toBe('round-results-hidden')
  })

  it('keeps final standings private only in host-only mode', () => {
    expect(playersSeeFinalLeaderboard('question')).toBe(true)
    expect(playersSeeFinalLeaderboard('round')).toBe(true)
    expect(playersSeeFinalLeaderboard('final')).toBe(true)
    expect(playersSeeFinalLeaderboard('host')).toBe(false)
  })

  it('inserts standings after each question only in question mode', () => {
    expect(showsLeaderboardAfterQuestion('question')).toBe(true)
    expect(showsLeaderboardAfterQuestion('round')).toBe(false)
    expect(showsLeaderboardAfterQuestion('final')).toBe(false)
    expect(showsLeaderboardAfterQuestion('host')).toBe(false)
  })

  it('defaults old or malformed settings to end-of-round visibility', () => {
    expect(leaderboardVisibilityFromSettings(null)).toBe('round')
    expect(leaderboardVisibilityFromSettings({})).toBe('round')
    expect(leaderboardVisibilityFromSettings({ leaderboard_visibility: 'unexpected' })).toBe('round')
    expect(leaderboardVisibilityFromSettings({ leaderboard_visibility: 'final' })).toBe('final')
    expect(leaderboardVisibilityFromSettings({ leaderboard_visibility: 'always' })).toBe('question')
  })
})
