export type QuizExitPrompt = 'discard-quiz' | 'discard-changes' | null

export function quizExitPrompt(input: { newQuiz: boolean; dirty: boolean }): QuizExitPrompt {
  if (input.newQuiz) return 'discard-quiz'
  if (input.dirty) return 'discard-changes'
  return null
}
