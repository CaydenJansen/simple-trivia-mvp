import { isValidTiebreakerNumericValue, needsMoreManualTiebreakers } from './tiebreakers'

export type QuizReadinessInput = {
  title: string
  rounds: Array<{
    questionCount: number
    contentScreenTitles: string[]
  }>
  tiebreakers: Array<{
    prompt: string
    correctValue: string
  }>
}

export type QuizReadiness = {
  blockers: string[]
  warnings: string[]
  ready: boolean
}

export function checkQuizReadiness(input: QuizReadinessInput): QuizReadiness {
  const blockers: string[] = []
  const questionCount = input.rounds.reduce((total, round) => total + round.questionCount, 0)

  if (!input.title.trim()) blockers.push('Add a quiz title.')
  if (questionCount === 0) blockers.push('Add at least one scored question.')
  if (input.rounds.some(round => round.contentScreenTitles.length > 0 && round.questionCount === 0)) {
    blockers.push('Each round with a content screen needs at least one scored question.')
  }
  if (input.rounds.some(round => round.contentScreenTitles.some(title => !title.trim()))) {
    blockers.push('Give every content screen a title.')
  }
  if (input.tiebreakers.some(tiebreaker => !tiebreaker.prompt.trim())) {
    blockers.push('Finish or remove every incomplete tiebreaker question.')
  }
  if (input.tiebreakers.some(tiebreaker => !isValidTiebreakerNumericValue(tiebreaker.correctValue))) {
    blockers.push('Give every tiebreaker a numeric correct answer, without words or units.')
  }

  const warnings = needsMoreManualTiebreakers(input.tiebreakers.length)
    ? [`Only ${input.tiebreakers.length} prepared tiebreaker${input.tiebreakers.length === 1 ? '' : 's'}. We recommend at least 2, but you can continue without them.`]
    : []

  return { blockers, warnings, ready: blockers.length === 0 }
}

export function quizStatusFromReadiness(readiness: Pick<QuizReadiness, 'ready'>) {
  return readiness.ready ? 'ready' as const : 'draft' as const
}

export function quizCanHost(input: {
  persisted: boolean
  dirty: boolean
  ready: boolean
  status: 'draft' | 'ready'
}) {
  return input.persisted && !input.dirty && input.ready && input.status === 'ready'
}
