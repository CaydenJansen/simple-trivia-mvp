export type AutoRunMode = 'off' | 'round'

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

export function rankingItemCount(question: TimedQuestion) {
  if (question.question_type !== 'ranking') return 0
  return Array.isArray(question.correct_answer) ? question.correct_answer.length : 0
}

export function autoRunAnswerSeconds(question: TimedQuestion) {
  const workload = question.question_type === 'ranking'
    ? Math.max(1, rankingItemCount(question))
    : Math.max(1, Math.trunc(question.points_max ?? 1))
  return 30 + ((workload - 1) * 15)
}

export function autoRunRevealSeconds(question: TimedQuestion) {
  const parts = Array.isArray(question.correct_answer) ? question.correct_answer.length : 1
  const compound = question.question_type === 'multi-answer'
    || question.question_type === 'multi-part'
    || question.question_type === 'ranking'
  return compound ? 15 + (Math.max(1, parts) - 1) * 5 : 15
}

export const AUTO_RUN_CONTENT_SECONDS = 30
export const AUTO_RUN_ROUND_CHECKPOINT_SECONDS = 60
export const AUTO_RUN_EXTENSION_SECONDS = 15

export function autoRunClockLabel(seconds: number) {
  const safe = Math.max(0, Math.trunc(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}
