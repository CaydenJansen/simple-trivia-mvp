import type { Json } from '@/lib/supabase/database.types'

export type AudienceQuestionMode = 'favourite' | 'closest-number'

export type AudienceQuestionSettings = {
  mode: AudienceQuestionMode
  prompt: string
  correctNumber: number | null
  allowMultipleWinners: boolean
  shareResponses: boolean
}

export type AudienceResponseOrder = 'submitted' | 'votes'

export function compareAudienceResponses(
  left: { submittedAt: string; voteCount: number },
  right: { submittedAt: string; voteCount: number },
  order: AudienceResponseOrder,
) {
  if (order === 'votes' && right.voteCount !== left.voteCount) return right.voteCount - left.voteCount
  return new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime()
}

function record(value: Json | null | undefined): Record<string, Json> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json> : {}
}

export function audienceQuestionFromSettings(settings: Json | null | undefined): AudienceQuestionSettings {
  const value = record(settings)
  const mode: AudienceQuestionMode = value.audience_question_mode === 'closest-number' ? 'closest-number' : 'favourite'
  const parsedNumber = typeof value.correct_number === 'number' ? value.correct_number : Number(value.correct_number)
  return {
    mode,
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    correctNumber: Number.isFinite(parsedNumber) ? parsedNumber : null,
    allowMultipleWinners: value.allow_multiple_winners === true,
    shareResponses: mode === 'favourite' && value.audience_responses_visible === true,
  }
}

export function audienceQuestionSettings(value: AudienceQuestionSettings): Record<string, Json> {
  return {
    audience_question_mode: value.mode,
    prompt: value.prompt.trim(),
    correct_number: value.mode === 'closest-number' ? value.correctNumber : null,
    allow_multiple_winners: value.mode === 'favourite' && value.allowMultipleWinners,
    audience_responses_visible: value.mode === 'favourite' && value.shareResponses,
  }
}

export function audienceQuestionPlayerInstructions(settings: Json | null | undefined) {
  return audienceQuestionFromSettings(settings).mode === 'closest-number'
    ? 'Enter your best numerical guess. The closest answer wins.'
    : 'Answer the question with something good. The host may pick your response as the winner.'
}

export function audienceQuestionHostInstructions(settings: Json | null | undefined) {
  return audienceQuestionFromSettings(settings).mode === 'closest-number'
    ? 'Teams submit numerical guesses. You can see the closest response live, then confirm the result.'
    : 'Teams submit their answers. Select your favourite response, then confirm the winner.'
}
