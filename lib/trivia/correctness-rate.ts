export type CorrectnessSubmission = {
  is_correct: boolean | null
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
