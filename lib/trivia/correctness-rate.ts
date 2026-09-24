import { asStringArray, normaliseTriviaAnswer } from './grading'

export type CorrectnessSubmission = {
  is_correct: boolean | null
}

type GradedItem = { expected?: string; status: string }

// Multi-answer grading follows input order, not the question's answer order.
export function correctAnswerIndex(answers: unknown, item: GradedItem): number {
  if (!item.expected) return -1
  return asStringArray(answers).findIndex(answer => normaliseTriviaAnswer(answer) === normaliseTriviaAnswer(item.expected!))
}

export function answerCorrectnessSummaries(
  questionType: string,
  answers: unknown,
  totalTeams: number,
  submissions: { items: GradedItem[] }[],
): CorrectnessSummary[] {
  return asStringArray(answers).map((_, index) => correctnessSummary(totalTeams, submissions.map(grading => ({
    is_correct: questionType === 'multi-answer'
      ? grading.items.some(item => item.status === 'correct' && correctAnswerIndex(answers, item) === index)
      : grading.items[index]?.status === 'correct',
  }))))
}

export type CorrectnessSummary = {
  correct: number
  total: number
  percentage: number
}

export function correctnessSummary(
  totalTeams: number,
  submissions: CorrectnessSubmission[],
): CorrectnessSummary {
  const total = Math.max(0, Math.trunc(totalTeams))
  const correct = Math.min(total, submissions.filter(submission => submission.is_correct === true).length)

  return {
    correct,
    total,
    percentage: total === 0 ? 0 : Math.round((correct / total) * 100),
  }
}
