export type AutoRunMode = 'off' | 'round'
export type AutoRunSpeed = 'fast' | 'medium' | 'slow'

type TimedQuestion = {
  question_type?: string | null
  points_max?: number | null
  correct_answer?: unknown
}

function settingsRecord(settings: unknown): Record<string, unknown> | null {
  return settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : null
}

export function autoRunModeFromSettings(settings: unknown): AutoRunMode {
  return settingsRecord(settings)?.auto_run_mode === 'round' ? 'round' : 'off'
}

export function autoRunSpeedFromSettings(settings: unknown): AutoRunSpeed {
  const value = settingsRecord(settings)?.auto_run_speed
  return value === 'medium' || value === 'slow' ? value : 'fast'
}

export function autoRunScaledSeconds(seconds: number, speed: AutoRunSpeed) {
  const multiplier = speed === 'slow' ? 1.4 : speed === 'medium' ? 1.2 : 1
  return Math.max(1, Math.round(seconds * multiplier))
}

export function rankingItemCount(question: TimedQuestion) {
  if (question.question_type !== 'ranking') return 0
  return Array.isArray(question.correct_answer) ? question.correct_answer.length : 0
}

export function autoRunAnswerSeconds(question: TimedQuestion) {
  if (question.question_type === 'ranking') {
    return 30 + ((Math.max(1, rankingItemCount(question)) - 1) * 5)
  }
  const workload = Math.max(1, Math.trunc(question.points_max ?? 1))
  return 30 + ((workload - 1) * 15)
}

export function autoRunRemainingAfterAllLocked(remaining: number, allPlayersLocked: boolean) {
  const safe = Math.max(0, Math.trunc(remaining))
  return allPlayersLocked ? Math.min(safe, 5) : safe
}

export function autoRunRevealSeconds(question: TimedQuestion) {
  const parts = Array.isArray(question.correct_answer) ? question.correct_answer.length : 1
  return Math.min(10, 5 + ((Math.max(1, parts) - 1) * 2))
}

export const AUTO_RUN_CONTENT_SECONDS = 30
export const AUTO_RUN_SHOW_GAME_INSTRUCTIONS_SECONDS = 20
export const AUTO_RUN_SHOW_GAME_RESULT_SECONDS = 10
export const AUTO_RUN_ROUND_CHECKPOINT_SECONDS = 60
export const AUTO_RUN_EXTENSION_SECONDS = 15

export function autoRunShowGameResultSeconds(gameType: string | null | undefined) {
  return gameType === 'in-show-tiebreaker' ? 0 : AUTO_RUN_SHOW_GAME_RESULT_SECONDS
}

export function autoRunShouldAdvanceShowGameResult(gameType: string | null | undefined) {
  return gameType !== 'in-show-tiebreaker'
}

export function autoRunClockLabel(seconds: number) {
  const safe = Math.max(0, Math.trunc(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export type AutoRunSharedClock = {
  key: string
  label: string
  deadline_ms: number | null
  paused_remaining: number | null
}

export function autoRunClockFromSettings(settings: unknown, now = Date.now()) {
  const raw = settingsRecord(settings)?.auto_run_clock
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const clock = raw as Record<string, unknown>
  const key = typeof clock.key === 'string' ? clock.key : ''
  const label = typeof clock.label === 'string' ? clock.label : ''
  const deadline = typeof clock.deadline_ms === 'number' && Number.isFinite(clock.deadline_ms)
    ? clock.deadline_ms
    : null
  const paused = typeof clock.paused_remaining === 'number' && Number.isFinite(clock.paused_remaining)
    ? Math.max(0, Math.trunc(clock.paused_remaining))
    : null
  const remaining = paused ?? (deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000)))
  if (!key || !label || remaining <= 0) return null
  return { key, label, remaining, paused: paused !== null }
}

export function autoRunClockColor(seconds: number) {
  if (seconds <= 5) return '#DC2626'
  if (seconds <= 10) return '#D97706'
  return '#7C3AED'
}
