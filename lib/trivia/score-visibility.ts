export type PlayerScoreVisibility = 'live' | 'round' | 'final' | 'hidden'

export function playerScoreVisibilityFromSettings(settings: unknown): PlayerScoreVisibility {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 'live'
  const record = settings as Record<string, unknown>
  if (record.player_score_visibility === 'live'
    || record.player_score_visibility === 'round'
    || record.player_score_visibility === 'final'
    || record.player_score_visibility === 'hidden') {
    return record.player_score_visibility
  }
  return record.scores_visible_to_players === false ? 'hidden' : 'live'
}

export function playersSeeScoresFromSettings(settings: unknown) {
  return playerScoreVisibilityFromSettings(settings) === 'live'
}

export function playersSeeScoresOnScreen(settings: unknown, screen: string, roundScoresFinalized = false) {
  const mode = playerScoreVisibilityFromSettings(settings)
  if (mode === 'hidden') return false
  if (mode === 'live') return true
  if (mode === 'final') return screen === 'winner' || screen === 'final-result' || screen === 'game-ended'
  if (screen === 'winner' || screen === 'final-result' || screen === 'game-ended') return true
  return roundScoresFinalized && (screen === 'round-results' || screen === 'round-results-hidden' || screen === 'intermission')
}
