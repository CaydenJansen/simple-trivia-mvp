import type { Json } from '@/lib/supabase/database.types'
import { reviewStatusForPair, type SubmissionGrading } from './grading'

export type RuntimeBonus = {
  prompt: string
  correctAnswer: string
  acceptedAnswers: string[]
  points: number
  imageUrl: string | null
}

export type BonusSubmissionForScoring = {
  id: string
  answer_text: string
  is_correct: boolean | null
  grading_json: SubmissionGrading | null
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function textValue(value: unknown) {
  if (typeof value === 'string') return value
  return value == null ? '' : String(value)
}

export function runtimeBonusFromJson(value: Json | null | undefined): RuntimeBonus | null {
  const bonus = objectValue(value)
  if (!bonus) return null

  const prompt = textValue(bonus.prompt).trim()
  const correctAnswer = textValue(bonus.correct_answer).trim()
  const points = Math.max(1, Number(bonus.points) || 1)
  if (!prompt || !correctAnswer) return null

  return {
    prompt,
    correctAnswer,
    acceptedAnswers: Array.isArray(bonus.accepted_answers)
      ? bonus.accepted_answers.map(textValue).map(answer => answer.trim()).filter(Boolean)
      : [],
    points,
    imageUrl: textValue(bonus.image_url).trim() || null,
  }
}

export function buildBonusGrading(bonus: RuntimeBonus, answerText: string): SubmissionGrading {
  const candidates = [bonus.correctAnswer, ...bonus.acceptedAnswers]
  const statuses = candidates.map(expected => ({
    expected,
    status: reviewStatusForPair(answerText, expected),
  }))
  const match = statuses.find(item => item.status === 'correct')
    ?? statuses.find(item => item.status === 'review')
    ?? statuses[0]

  return {
    items: [{
      submitted: answerText,
      expected: match?.expected ?? bonus.correctAnswer,
      status: match?.status ?? 'incorrect',
    }],
  }
}

export function storedBonusGrading(bonus: RuntimeBonus, submission: BonusSubmissionForScoring): SubmissionGrading {
  const item = submission.grading_json?.items?.[0]
  if (!item) return buildBonusGrading(bonus, submission.answer_text)

  return {
    items: [{
      submitted: String(item.submitted ?? submission.answer_text),
      expected: item.expected === undefined ? bonus.correctAnswer : String(item.expected),
      status: item.status === 'correct' || item.status === 'review' ? item.status : 'incorrect',
    }],
  }
}

export function buildBonusRevealResults(bonus: RuntimeBonus | null, submissions: BonusSubmissionForScoring[]) {
  if (!bonus) return []

  return submissions
    .filter(submission => submission.is_correct === null)
    .map((submission) => {
      const grading = storedBonusGrading(bonus, submission)
      const correct = grading.items[0]?.status === 'correct'
      return {
        submission_id: submission.id,
        is_correct: correct,
        points_awarded: correct ? bonus.points : 0,
        grading_json: grading,
      }
    })
}
