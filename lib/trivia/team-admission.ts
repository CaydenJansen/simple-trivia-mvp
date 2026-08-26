import { gameAcceptsNewTeams } from './game-joining'

export type TeamAdmissionStatus = 'pending' | 'approved' | 'denied'

export type TeamAdmissionResult = {
  admission_status: TeamAdmissionStatus
  team_id: string | null
  name: string
  game_status: string
}

export type TeamAdmissionTransition =
  | { kind: 'waiting' }
  | { kind: 'approved'; teamId: string; name: string }
  | { kind: 'denied' }
  | { kind: 'game-ended' }

export function teamAdmissionTransition(result: TeamAdmissionResult | null): TeamAdmissionTransition {
  if (!result || !gameAcceptsNewTeams(result.game_status)) return { kind: 'game-ended' }
  if (result.admission_status === 'denied') return { kind: 'denied' }
  if (result.admission_status === 'approved' && result.team_id) {
    return { kind: 'approved', teamId: result.team_id, name: result.name }
  }
  return { kind: 'waiting' }
}
