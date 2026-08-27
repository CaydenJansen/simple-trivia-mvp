import type { Json } from '@/lib/supabase/database.types'

export type AudienceQuestionMode = 'favourite' | 'closest-number'

export type AudienceQuestionSettings = {
  mode: AudienceQuestionMode
  prompt: string
  correctNumber: number | null
  allowMultipleWinners: boolean
}

function record(value: Json | null | undefined): Record<string, Json> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json> : {}
}

export function audienceQuestionFromSettings(settings: Json | null | undefined): AudienceQuestionSettings {
  const value = record(settings)
  const parsedNumber = typeof value.correct_number === 'number' ? value.correct_number : Number(value.correct_number)
  return {
    mode: value.audience_question_mode === 'closest-number' ? 'closest-number' : 'favourite',
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    correctNumber: Number.isFinite(parsedNumber) ? parsedNumber : null,
    allowMultipleWinners: value.allow_multiple_winners === true,
  }
}

export function audienceQuestionSettings(value: AudienceQuestionSettings): Record<string, Json> {
  return {
    audience_question_mode: value.mode,
    prompt: value.prompt.trim(),
    correct_number: value.mode === 'closest-number' ? value.correctNumber : null,
    allow_multiple_winners: value.mode === 'favourite' && value.allowMultipleWinners,
  }
}
