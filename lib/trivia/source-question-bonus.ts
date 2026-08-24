import type { AudienceScope, AudienceSuitability, ContentFlag, FactualStability, Json } from '@/lib/supabase/database.types'

export type SourceQuestionBonusDraft = {
  enabled: boolean
  prompt: string
  answer: string
  aliases: string
  points: number
  imageUrl: string
  primaryCategoryId: string
  secondaryCategoryIds: string[]
  editorialDifficulty: number | ''
  tagIds: string[]
  promptPatternId: string
  answerTypeId: string
  stability: FactualStability | ''
  audienceSuitability: AudienceSuitability | ''
  audienceScope: AudienceScope | ''
  audienceLocale: string
  contentFlags: ContentFlag[] | null
}

export const EMPTY_SOURCE_QUESTION_BONUS: SourceQuestionBonusDraft = {
  enabled: false,
  prompt: '',
  answer: '',
  aliases: '',
  points: 1,
  imageUrl: '',
  primaryCategoryId: '',
  secondaryCategoryIds: [],
  editorialDifficulty: '',
  tagIds: [],
  promptPatternId: '',
  answerTypeId: '',
  stability: '',
  audienceSuitability: '',
  audienceScope: '',
  audienceLocale: '',
  contentFlags: null,
}

function objectValue(value: Json | null | undefined): Record<string, Json | undefined> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function stringArray(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.map(item => String(item ?? '')).filter(Boolean) : []
}

export function sourceQuestionBonusDraft(value: Json | null | undefined): SourceQuestionBonusDraft {
  const bonus = objectValue(value)
  if (!bonus) return { ...EMPTY_SOURCE_QUESTION_BONUS }

  return {
    enabled: true,
    prompt: String(bonus.prompt ?? ''),
    answer: String(bonus.correct_answer ?? ''),
    aliases: stringArray(bonus.accepted_answers).join(', '),
    points: Math.max(1, Number(bonus.points) || 1),
    imageUrl: String(bonus.image_url ?? ''),
    primaryCategoryId: String(bonus.primary_category_id ?? ''),
    secondaryCategoryIds: stringArray(bonus.secondary_category_ids),
    editorialDifficulty: bonus.editorial_difficulty == null ? '' : Number(bonus.editorial_difficulty),
    tagIds: stringArray(bonus.tag_ids),
    promptPatternId: String(bonus.prompt_pattern_id ?? ''),
    answerTypeId: String(bonus.answer_type_id ?? ''),
    stability: (bonus.stability as FactualStability | undefined) ?? '',
    audienceSuitability: (bonus.audience_suitability as AudienceSuitability | undefined) ?? '',
    audienceScope: (bonus.audience_scope as AudienceScope | undefined) ?? '',
    audienceLocale: String(bonus.audience_locale ?? ''),
    contentFlags: bonus.content_flags == null ? null : stringArray(bonus.content_flags) as ContentFlag[],
  }
}

export function validateSourceQuestionBonus(draft: SourceQuestionBonusDraft): string | null {
  if (!draft.enabled) return null
  if (!draft.prompt.trim()) return 'Add the bonus question text.'
  if (!draft.answer.trim()) return 'Add the bonus answer.'
  if (!Number.isInteger(draft.points) || draft.points < 1) return 'Bonus points must be a whole number greater than zero.'
  if (draft.editorialDifficulty !== '' && (draft.editorialDifficulty < 1 || draft.editorialDifficulty > 5)) {
    return 'Bonus difficulty must be between Very Easy and Very Hard.'
  }
  if (draft.audienceScope === 'country_specific' && !draft.audienceLocale.trim()) {
    return 'Add a country or locale for a country-specific bonus.'
  }
  return null
}

export function sourceQuestionBonusPayload(draft: SourceQuestionBonusDraft): Json | null {
  if (!draft.enabled) return null

  return {
    prompt: draft.prompt.trim(),
    correct_answer: draft.answer.trim(),
    accepted_answers: draft.aliases.split(',').map(alias => alias.trim()).filter(Boolean),
    points: draft.points,
    image_url: draft.imageUrl.trim() || null,
    primary_category_id: draft.primaryCategoryId || null,
    secondary_category_ids: draft.secondaryCategoryIds,
    editorial_difficulty: draft.editorialDifficulty || null,
    tag_ids: draft.tagIds,
    prompt_pattern_id: draft.promptPatternId || null,
    answer_type_id: draft.answerTypeId || null,
    stability: draft.stability || null,
    audience_suitability: draft.audienceSuitability || null,
    audience_scope: draft.audienceScope || null,
    audience_locale: draft.audienceScope === 'country_specific' ? draft.audienceLocale.trim() : null,
    content_flags: draft.contentFlags,
  }
}

export function estimatedQuizMinutes(questionCount: number, bonusCount: number): number {
  return Math.round((Math.max(0, questionCount) + Math.max(0, bonusCount)) * 2.4)
}
