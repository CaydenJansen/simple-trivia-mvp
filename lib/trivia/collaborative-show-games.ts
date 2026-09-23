import type { Json } from '@/lib/supabase/database.types'

function record(value: Json | null | undefined): Record<string, Json> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json> : {}
}

export type SharedCursorPosition = { x: number; y: number }

export type SharedCursorState = {
  x: number
  y: number
  candidateTeamId: string | null
  candidateSince: number | null
  positions: Record<string, SharedCursorPosition>
}

export type SharedCursorStamina = {
  remaining: number
  maximum: number
  percent: number
  coolingDown: boolean
  cooldownSeconds: number
}

export function sharedCursorState(settings: Json | null | undefined): SharedCursorState {
  const value = record(settings)
  const rawPositions = record(value.cursor_positions)
  const positions = Object.fromEntries(Object.entries(rawPositions).flatMap(([teamId, raw]) => {
    const point = record(raw)
    const x = Number(point.x)
    const y = Number(point.y)
    return Number.isFinite(x) && Number.isFinite(y) ? [[teamId, { x, y }]] : []
  }))
  const candidateSince = Number(value.cursor_candidate_since_ms)
  return {
    x: Number.isFinite(Number(value.cursor_x)) ? Number(value.cursor_x) : 0,
    y: Number.isFinite(Number(value.cursor_y)) ? Number(value.cursor_y) : 0,
    candidateTeamId: typeof value.cursor_candidate_id === 'string' ? value.cursor_candidate_id : null,
    candidateSince: Number.isFinite(candidateSince) && candidateSince > 0 ? candidateSince : null,
    positions,
  }
}

export function sharedCursorStamina(settings: Json | null | undefined, teamId: string | null | undefined, now: number): SharedCursorStamina {
  const maximum = 5
  const value = record(settings)
  const staminaByTeam = record(value.cursor_stamina)
  const team = teamId ? record(staminaByTeam[teamId]) : {}
  const savedRemaining = Math.max(0, Math.min(maximum, Number(team.remaining ?? maximum)))
  const updatedAt = Number(team.updated_at_ms ?? now)
  const rawCooldownUntil = team.cooldown_until_ms
  const cooldownUntil = rawCooldownUntil === null || rawCooldownUntil === undefined ? Number.NaN : Number(rawCooldownUntil)
  const coolingDown = Number.isFinite(cooldownUntil) && cooldownUntil > now
  const cooldownCompleted = Number.isFinite(cooldownUntil) && cooldownUntil <= now
  const cooldownSeconds = coolingDown ? Math.max(1, Math.ceil((cooldownUntil - now) / 1000)) : 0
  const recovered = coolingDown ? 0 : Math.max(0, Math.floor((now - updatedAt) / 1000))
  const remaining = coolingDown ? 0 : cooldownCompleted ? maximum : Math.min(maximum, savedRemaining + recovered)
  return {
    remaining,
    maximum,
    percent: (remaining / maximum) * 100,
    coolingDown,
    cooldownSeconds,
  }
}

export function lowestUniqueBid<T extends { bid: number }>(entries: T[]): T | null {
  const counts = new Map<number, number>()
  for (const entry of entries) counts.set(entry.bid, (counts.get(entry.bid) ?? 0) + 1)
  return [...entries].filter(entry => counts.get(entry.bid) === 1).sort((left, right) => left.bid - right.bid)[0] ?? null
}

export function bombPhase(settings: Json | null | undefined, now: number) {
  const armedAt = Date.parse(String(record(settings).armed_at ?? ''))
  if (!Number.isFinite(armedAt)) return { armed: true, seconds: 0 }
  return { armed: now >= armedAt, seconds: Math.max(0, Math.ceil((armedAt - now) / 1000)) }
}

export function bombDangerWindowSeconds(settings: Json | null | undefined, now: number) {
  const value = record(settings)
  const armedAt = Date.parse(String(value.armed_at ?? ''))
  const configuredEnd = Date.parse(String(value.danger_ends_at ?? ''))
  if (!Number.isFinite(armedAt)) return 0
  const dangerEndsAt = Number.isFinite(configuredEnd) ? configuredEnd : armedAt + 60_000
  return Math.max(0, Math.ceil((dangerEndsAt - now) / 1000))
}

export function bombIsOvertime(settings: Json | null | undefined) {
  return record(settings).overtime === true
}
