export type QuestionQuizUsage = {
  quizId: string
  quizTitle: string
  quizUpdatedAt: string
}

export type QuestionQuizUsageRow = QuestionQuizUsage & {
  sourceQuestionId: string
}

export type QuestionQuizUsageDatabaseRow = {
  source_question_id: string | null
  quiz_id: string
  quiz: { title: string; updated_at: string } | { title: string; updated_at: string }[] | null
}

export function questionQuizUsageRowsFromDatabase(rows: readonly QuestionQuizUsageDatabaseRow[]) {
  return rows.flatMap((row): QuestionQuizUsageRow[] => {
    const quiz = Array.isArray(row.quiz) ? row.quiz[0] : row.quiz
    if (!row.source_question_id || !quiz) return []

    return [{
      sourceQuestionId: row.source_question_id,
      quizId: row.quiz_id,
      quizTitle: quiz.title,
      quizUpdatedAt: quiz.updated_at,
    }]
  })
}

export function groupQuestionQuizUsage(rows: readonly QuestionQuizUsageRow[]) {
  const grouped: Record<string, QuestionQuizUsage[]> = {}

  rows.forEach(row => {
    const current = grouped[row.sourceQuestionId] ?? []
    if (current.some(usage => usage.quizId === row.quizId)) return

    grouped[row.sourceQuestionId] = [
      ...current,
      {
        quizId: row.quizId,
        quizTitle: row.quizTitle,
        quizUpdatedAt: row.quizUpdatedAt,
      },
    ].sort((a, b) => b.quizUpdatedAt.localeCompare(a.quizUpdatedAt))
  })

  return grouped
}

export function questionQuizUsageSummary(usages: readonly QuestionQuizUsage[]) {
  if (usages.length === 0) return 'Not used in any of your quizzes'
  if (usages.length === 1) return usages[0].quizTitle

  const quizTitles = [...new Set(usages.map(usage => usage.quizTitle))]
  if (quizTitles.length === 1) return `${quizTitles[0]} (${usages.length} quizzes)`
  if (quizTitles.length === 2 && usages.length === 2) return `${quizTitles[0]} and ${quizTitles[1]}`
  if (quizTitles.length === 2) return `${quizTitles[0]}, ${quizTitles[1]} · ${usages.length} quizzes`
  return `${quizTitles[0]}, ${quizTitles[1]} +${quizTitles.length - 2} more`
}
