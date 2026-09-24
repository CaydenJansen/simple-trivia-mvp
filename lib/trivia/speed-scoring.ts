export type ScoringMode = 'classic' | 'speed'

export function speedScoringEnabled(settings: unknown): boolean {
  return !!settings && typeof settings === 'object' && !Array.isArray(settings)
    && (settings as Record<string, unknown>).scoring_mode === 'speed'
}

export function speedPointsAvailable(elapsedSeconds: number, durationSeconds: number): number {
  const progress = Math.min(1, Math.max(0, elapsedSeconds / Math.max(1, durationSeconds)))
  return Math.round(100 - 50 * progress)
}

export function speedAward(basePoints: number, baseMaximum: number, available: number): number {
  return Math.round(Math.min(Math.max(1, baseMaximum), Math.max(0, basePoints)) * Math.max(50, Math.min(100, available)))
}

export function speedClock(settings: unknown): { key: string; deadline_ms: number; duration_seconds: number } | null {
  if (!speedScoringEnabled(settings)) return null
  const value = (settings as Record<string, unknown>).speed_clock
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const clock = value as Record<string, unknown>
  return typeof clock.key === 'string' && typeof clock.deadline_ms === 'number' && Number.isFinite(clock.deadline_ms)
    && typeof clock.duration_seconds === 'number' && clock.duration_seconds > 0
    ? { key: clock.key, deadline_ms: clock.deadline_ms, duration_seconds: clock.duration_seconds } : null
}
