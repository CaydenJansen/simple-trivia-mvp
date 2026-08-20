export type HostRecoveryScreen = 'dashboard' | 'lobby' | 'live-question' | 'end-of-round' | 'final-results'

const ROUND_END_SCREENS = new Set([
  'delayed-reveal',
  'intermission',
  'round-results',
  'round-results-hidden',
])

export function hostRecoveryScreen(status: string | null, currentScreen: string | null): HostRecoveryScreen {
  if (currentScreen === 'lobby') return 'lobby'
  if (ROUND_END_SCREENS.has(currentScreen ?? '')) return 'end-of-round'
  if (currentScreen === 'final-result' || status === 'finished') return 'final-results'
  if (status === 'live' || currentScreen === 'round-start' || currentScreen === 'content-screen') return 'live-question'
  return 'dashboard'
}

export const PLAYER_SESSION_KEYS = [
  'simple-trivia-game-id',
  'simple-trivia-game-code',
  'simple-trivia-game-title',
  'simple-trivia-team-id',
  'simple-trivia-team-name',
  'simple-trivia-last-answer',
] as const
