import type { Json } from '@/lib/supabase/database.types'

export function hostGameSettingsRecord(value: Json | null | undefined): Record<string, Json> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, Json>
}

export function mergeHostGameSettings(current: Json | null | undefined, patch: Record<string, Json>) {
  return { ...hostGameSettingsRecord(current), ...patch }
}

const PERSISTENT_GAME_SETTING_KEYS = [
  'answer_reveal',
  'leaderboard_visibility',
  'auto_run_mode',
  'team_approval_required',
  'player_score_visibility',
  'scores_visible_to_players',
  'show_correctness_percentage_to_players',
  'submitted_answers_editable',
  'top_prizes',
  'bottom_prizes',
] as const

export function persistentHostGameSettings(settings: Record<string, Json>) {
  return Object.fromEntries(
    PERSISTENT_GAME_SETTING_KEYS.flatMap(key => key in settings ? [[key, settings[key]]] : []),
  ) as Record<string, Json>
}
