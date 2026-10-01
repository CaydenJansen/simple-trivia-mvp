import type { Json } from '@/lib/supabase/database.types'

export type Potato = { id: string; holder_id: string; born_at: string; received_at: string }
export type PotatoTeam = { id: string; name: string; banked: number; pending: number; bursts: number }
export type PotatoState = { teams: PotatoTeam[]; potatoes: Potato[]; sampledAt: number; revision: number }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

export function hotPotatoState(settings: Json | undefined): PotatoState {
  const state = record(record(settings).hot_potato)
  return {
    revision: nonnegative(state.revision),
    teams: (Array.isArray(state.teams) ? state.teams : []).flatMap(value => {
      const team = record(value)
      return typeof team.id === 'string' && typeof team.name === 'string'
        ? [{ id: team.id, name: team.name, banked: nonnegative(team.banked), pending: nonnegative(team.pending), bursts: nonnegative(team.bursts) }] : []
    }),
    potatoes: (Array.isArray(state.potatoes) ? state.potatoes : []).flatMap(value => {
      const potato = record(value)
      return ['id', 'holder_id', 'born_at', 'received_at'].every(key => typeof potato[key] === 'string')
        ? [potato as Potato] : []
    }),
    sampledAt: typeof state.sampled_at === 'string' ? Date.parse(state.sampled_at) || 0 : 0,
  }
}

// Extrapolate only one poll interval. Never invent a rising score indefinitely
// while disconnected; the server owns accrual, banking and explosion order.
export function hotPotatoPending(team: PotatoTeam, state: PotatoState, now: number, endsAt: number, finished: boolean) {
  if (finished) return 0
  const elapsed = Math.max(0, Math.min(1000, Math.min(now, endsAt) - state.sampledAt)) / 1000
  return team.pending + state.potatoes.filter(potato => potato.holder_id === team.id).length * elapsed
}

export function hotPotatoHeat(bornAt: string, now: number) {
  return Math.max(0, Math.min(1, (now - (Date.parse(bornAt) || now)) / 22000))
}

type Snapshot = { id: string; game_type: string; status: string; settings: Json }
export function staleHotPotatoSnapshot(current: Snapshot | null, incoming: Snapshot | null) {
  if (!current || !incoming || current.id !== incoming.id || incoming.game_type !== 'hot-potato') return false
  if (current.status === 'exploded' && incoming.status !== 'exploded') return true
  if (incoming.status === 'exploded' && current.status !== 'exploded') return false
  const previous = hotPotatoState(current.settings), next = hotPotatoState(incoming.settings)
  return previous.revision > next.revision || (previous.revision === next.revision && previous.sampledAt > next.sampledAt)
}
