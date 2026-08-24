export type LeaderboardVisibility = 'always' | 'round' | 'final' | 'host'

export function leaderboardVisibilityFromSettings(settings: unknown): LeaderboardVisibility {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 'round'
  const value = (settings as Record<string, unknown>).leaderboard_visibility
  return value === 'always' || value === 'round' || value === 'final' || value === 'host'
    ? value
    : 'round'
}

export function roundResultsScreen(visibility: LeaderboardVisibility) {
  return visibility === 'always' || visibility === 'round'
    ? 'round-results' as const
    : 'round-results-hidden' as const
}

export function playersSeeFinalLeaderboard(visibility: LeaderboardVisibility) {
  return visibility !== 'host'
}

export function playersSeeLiveLeaderboard(visibility: LeaderboardVisibility) {
  return visibility === 'always'
}
