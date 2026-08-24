export type LeaderboardVisibility = 'question' | 'round' | 'final' | 'host'

export function leaderboardVisibilityFromSettings(settings: unknown): LeaderboardVisibility {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 'round'
  const value = (settings as Record<string, unknown>).leaderboard_visibility
  if (value === 'always') return 'question'
  return value === 'question' || value === 'round' || value === 'final' || value === 'host' ? value : 'round'
}

export function roundResultsScreen(visibility: LeaderboardVisibility) {
  return visibility === 'question' || visibility === 'round'
    ? 'round-results' as const
    : 'round-results-hidden' as const
}

export function playersSeeFinalLeaderboard(visibility: LeaderboardVisibility) {
  return visibility !== 'host'
}

export function showsLeaderboardAfterQuestion(visibility: LeaderboardVisibility) {
  return visibility === 'question'
}
