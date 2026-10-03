import type { Json } from '@/lib/supabase/database.types'
import { TEAM_DORMANT_AFTER_MS } from './team-presence'

export type SessionTeam = { id: string; name: string; last_seen_at: string | null; simulated: boolean; submitted: boolean | null }
export type SessionHealth = { game_id: string; code: string; status: string; practice: boolean; paused: boolean; server_time: string; answer_phase: string; screen: string; teams: SessionTeam[] }

export function teamConnectionState(lastSeen: string | null, now: number): 'recent' | 'delayed' | 'asleep' {
  const seen = lastSeen ? Date.parse(lastSeen) : NaN
  if (!Number.isFinite(seen) || now - seen >= TEAM_DORMANT_AFTER_MS) return 'asleep'
  // Presence is sent every 45 seconds. Allow two missed beats before warning.
  return now - seen > 100_000 ? 'delayed' : 'recent'
}

export function parseSessionHealth(value: Json | null): SessionHealth | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.game_id !== 'string' || !Array.isArray(value.teams)) return null
  return {
    game_id: value.game_id, code: String(value.code ?? ''), status: String(value.status ?? ''), practice: value.practice === true,
    paused: value.paused === true, server_time: String(value.server_time ?? ''), answer_phase: String(value.answer_phase ?? ''), screen: String(value.screen ?? ''),
    teams: value.teams.flatMap(team => !team || typeof team !== 'object' || Array.isArray(team) || typeof team.id !== 'string' || typeof team.name !== 'string' ? [] : [{
      id: team.id, name: team.name, last_seen_at: typeof team.last_seen_at === 'string' ? team.last_seen_at : null,
      simulated: team.simulated === true, submitted: typeof team.submitted === 'boolean' ? team.submitted : null,
    }]),
  }
}
