import type { Json } from '@/lib/supabase/database.types'

export type ShowGameRewardType = 'points' | 'custom'

export type ShowGameReward = {
  type: ShowGameRewardType
  points: number
  description: string
  winnerMessage: string
}

export const DEFAULT_SHOW_GAME_REWARD: ShowGameReward = {
  type: 'points',
  points: 1,
  description: '',
  winnerMessage: '',
}

function settingsRecord(settings: Json | undefined): Record<string, Json | undefined> {
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
}

export function showGameRewardFromSettings(settings: Json | undefined): ShowGameReward {
  const record = settingsRecord(settings)
  const rawPoints = typeof record.reward_points === 'number'
    ? record.reward_points
    : Number(record.reward_points)

  return {
    type: record.reward_type === 'custom' ? 'custom' : 'points',
    points: Number.isInteger(rawPoints) ? Math.max(1, Math.min(100, rawPoints)) : 1,
    description: typeof record.reward_description === 'string' ? record.reward_description.trim() : '',
    winnerMessage: typeof record.winner_message === 'string' ? record.winner_message.trim() : '',
  }
}

export function showGameRewardDescription(reward: ShowGameReward): string {
  if (reward.description) return reward.description
  if (reward.type === 'points') {
    return `The winner of this game will win ${reward.points} bonus ${reward.points === 1 ? 'point' : 'points'}.`
  }
  return 'A custom prize chosen by the host.'
}

export function showGameWinnerMessage(reward: ShowGameReward): string {
  if (reward.type === 'custom') return reward.winnerMessage || 'You won! See the host to claim your prize.'
  return `You won! ${reward.points} bonus ${reward.points === 1 ? 'point has' : 'points have'} been added to your score.`
}

export function showGameRewardSettings(reward: ShowGameReward): Json {
  return {
    minimum_seconds: 10,
    maximum_seconds: 30,
    reward_type: reward.type,
    reward_points: reward.type === 'points' ? reward.points : 0,
    reward_description: reward.description || null,
    winner_message: reward.type === 'custom' ? reward.winnerMessage || null : null,
  }
}
