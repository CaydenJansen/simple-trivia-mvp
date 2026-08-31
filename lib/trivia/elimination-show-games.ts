import type { Json } from '@/lib/supabase/database.types'

export type ShowGameType = 'beat-the-bomb' | 'spin-the-wheel' | 'heads-or-tails' | 'dodge-the-rock' | 'scissors-paper-rock' | 'big-balloon' | 'steal-the-treasure' | 'audience-question' | 'in-show-tiebreaker'
export type EliminationShowGameType = 'heads-or-tails' | 'dodge-the-rock' | 'scissors-paper-rock'
export type EliminationRoundPhase = 'choosing' | 'reveal'
export const RANDOM_CHANCE_SHOW_GAME_TYPES = ['spin-the-wheel', 'beat-the-bomb', 'heads-or-tails', 'dodge-the-rock'] as const satisfies readonly ShowGameType[]

export function autoBuildShowGameTypes(roundCount: number, random: () => number = Math.random): ShowGameType[] {
  return Array.from({ length: Math.max(0, Math.trunc(roundCount)) }, () => {
    const index = Math.min(RANDOM_CHANCE_SHOW_GAME_TYPES.length - 1, Math.floor(Math.max(0, random()) * RANDOM_CHANCE_SHOW_GAME_TYPES.length))
    return RANDOM_CHANCE_SHOW_GAME_TYPES[index]
  })
}

export type EliminationShowGameState = {
  eligibleTeamIds: string[]
  aliveTeamIds: string[]
  eliminatedTeamIds: string[]
  roundEliminatedTeamIds: string[]
  roundNumber: number
  roundPhase: EliminationRoundPhase
  roundOutcome: string | null
  positions: Record<string, number>
  matchups: Array<{ teamAId: string; teamBId: string }>
  byeTeamId: string | null
}

function objectSettings(settings: Json | null | undefined): Record<string, Json> {
  return settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, Json>
    : {}
}

function stringArray(value: Json | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function isEliminationShowGame(type: string | null | undefined): type is EliminationShowGameType {
  return type === 'heads-or-tails' || type === 'dodge-the-rock' || type === 'scissors-paper-rock'
}

export function eliminationShowGameState(settings: Json | null | undefined): EliminationShowGameState {
  const value = objectSettings(settings)
  const rawPositions = value.positions && typeof value.positions === 'object' && !Array.isArray(value.positions)
    ? value.positions as Record<string, Json>
    : {}
  const positions = Object.fromEntries(Object.entries(rawPositions).map(([teamId, lane]) => [teamId, Math.max(0, Math.min(2, Number(lane) || 0))]))
  const matchups = Array.isArray(value.round_matchups)
    ? value.round_matchups.flatMap(matchup => {
        if (!matchup || typeof matchup !== 'object' || Array.isArray(matchup)) return []
        const row = matchup as Record<string, Json>
        return typeof row.team_a === 'string' && typeof row.team_b === 'string'
          ? [{ teamAId: row.team_a, teamBId: row.team_b }]
          : []
      })
    : []
  return {
    eligibleTeamIds: stringArray(value.eligible_team_ids),
    aliveTeamIds: stringArray(value.alive_team_ids),
    eliminatedTeamIds: stringArray(value.eliminated_team_ids),
    roundEliminatedTeamIds: stringArray(value.round_eliminated_team_ids),
    roundNumber: Math.max(1, Number(value.round_number) || 1),
    roundPhase: value.round_phase === 'reveal' ? 'reveal' : 'choosing',
    roundOutcome: typeof value.round_outcome === 'string' ? value.round_outcome : null,
    positions,
    matchups,
    byeTeamId: typeof value.round_bye_team_id === 'string' ? value.round_bye_team_id : null,
  }
}

export function showGameLabel(type: ShowGameType) {
  if (type === 'spin-the-wheel') return 'Spin the Wheel'
  if (type === 'beat-the-bomb') return 'Beat the Bomb'
  if (type === 'heads-or-tails') return 'Heads or Tails'
  if (type === 'scissors-paper-rock') return 'Scissors Paper Rock'
  if (type === 'big-balloon') return 'Big Balloon'
  if (type === 'steal-the-treasure') return 'Steal the Treasure'
  if (type === 'in-show-tiebreaker') return 'In-show Tiebreaker'
  if (type === 'audience-question') return 'Audience Question'
  return 'Dodge the Rock'
}

export function showGameEmoji(type: ShowGameType) {
  if (type === 'spin-the-wheel') return '🎡'
  if (type === 'beat-the-bomb') return '💣'
  if (type === 'heads-or-tails') return '🪙'
  if (type === 'scissors-paper-rock') return '✂️'
  if (type === 'big-balloon') return '🎈'
  if (type === 'steal-the-treasure') return '💰'
  if (type === 'in-show-tiebreaker') return '🎯'
  if (type === 'audience-question') return '💬'
  return '🪨'
}

export function showGameInstructions(type: ShowGameType) {
  if (type === 'spin-the-wheel') return 'Every joined team is placed on the wheel. It spins, slows down, and randomly selects one winner.'
  if (type === 'beat-the-bomb') return 'Each team can press once. Be the last team to press before the randomly timed bomb explodes.'
  if (type === 'heads-or-tails') return 'Call heads or tails before each flip. Correct teams stay in; the others are knocked out. Flips continue until one team remains.'
  if (type === 'scissors-paper-rock') return 'You’ll be paired against another team. Pick scissors, paper, or rock before the five-second timer ends. Win and you advance; lose and you’re eliminated. If it’s a draw, you both advance. An unpaired team gets a free pass. Rounds continue until one team remains.'
  if (type === 'big-balloon') return 'Press and hold to inflate your balloon, then release to lock in its size. Push it too far and it pops. The biggest balloon still intact wins.'
  if (type === 'steal-the-treasure') return 'Hold to steal treasure while the guard is asleep, then release to bank it. If the guard catches you holding, that unbanked haul is lost. The most banked treasure wins.'
  if (type === 'in-show-tiebreaker') return 'Everyone submits a numerical answer. The closest answer becomes the latest tie-ordering result without changing anyone\'s score.'
  if (type === 'audience-question') return 'Ask the room something fun. Pick your favourite response, or use Closest Guess to find the nearest numerical answer.'
  return 'Move your character between three lanes before positions lock. A rock hits one random lane each round. Survive until your team is the last one standing.'
}
