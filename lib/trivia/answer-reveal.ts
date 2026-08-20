export type AnswerRevealMode = 'each' | 'round'

export function answerRevealModeFromSettings(settings: unknown): AnswerRevealMode {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 'each'
  return (settings as Record<string, unknown>).answer_reveal === 'round' ? 'round' : 'each'
}
