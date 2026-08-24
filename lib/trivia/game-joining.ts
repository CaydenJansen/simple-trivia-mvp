export const JOINABLE_GAME_STATUSES = ['lobby', 'live'] as const

export function gameAcceptsNewTeams(status: string | null | undefined) {
  return status === 'lobby' || status === 'live'
}
