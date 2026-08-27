export const MANUAL_TIEBREAKER_RECOMMENDATION = 2
export const AUTO_BUILD_TIEBREAKER_COUNT = 2

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

export function isValidTiebreakerNumericValue(value: string) {
  return DECIMAL_NUMBER.test(value.trim())
}

export function needsMoreManualTiebreakers(count: number) {
  return count < MANUAL_TIEBREAKER_RECOMMENDATION
}

export function hasRequiredAutoBuildTiebreakers(count: number) {
  return count === AUTO_BUILD_TIEBREAKER_COUNT
}

export type TiebreakerReplacementOption = {
  id: string
  primary_category_id: string | null
  editorial_difficulty: number | null
}

export function availableTiebreakerReplacements<T extends TiebreakerReplacementOption>(
  options: T[],
  currentSourceId: string,
  usedSourceIds: ReadonlySet<string>,
) {
  const current = options.find(option => option.id === currentSourceId)
  const fit = (option: T) =>
    Number(Boolean(current?.primary_category_id && option.primary_category_id === current.primary_category_id)) * 4
    + Number(Boolean(current?.editorial_difficulty && option.editorial_difficulty === current.editorial_difficulty)) * 2

  return options
    .filter(option => !usedSourceIds.has(option.id))
    .sort((a, b) => fit(b) - fit(a) || a.id.localeCompare(b.id))
}

export type NumericTiebreakerAnswer = {
  teamId: string
  value: number
}

export type TiebreakerDistance = {
  teamId: string
  distance: number | null
}

export function closestTiebreakerTeamIds(submissions: TiebreakerDistance[]) {
  const completed = submissions.filter(
    (submission): submission is TiebreakerDistance & { distance: number } => submission.distance !== null,
  )
  if (completed.length === 0) return new Set<string>()

  const closestDistance = Math.min(...completed.map(submission => submission.distance))
  return new Set(
    completed
      .filter(submission => submission.distance === closestDistance)
      .map(submission => submission.teamId),
  )
}

export type PlayerTiebreakerOutcome = 'won' | 'lost' | 'tied'

export function playerTiebreakerOutcome(
  attemptStatus: 'open' | 'closed' | 'resolved' | 'tied',
  isWinner: boolean | null,
): PlayerTiebreakerOutcome | null {
  if (attemptStatus === 'tied') return 'tied'
  if (attemptStatus !== 'resolved') return null
  return isWinner ? 'won' : 'lost'
}

export function evaluateClosestAnswers(correctValue: number, answers: NumericTiebreakerAnswer[]) {
  const ranked = answers
    .map(answer => ({ ...answer, distance: Math.abs(answer.value - correctValue) }))
    .sort((a, b) => a.distance - b.distance || a.teamId.localeCompare(b.teamId))
  const unresolved = ranked.some((answer, index) => index > 0 && answer.distance === ranked[index - 1].distance)

  return {
    ranked,
    unresolved,
    orderedTeamIds: unresolved ? null : ranked.map(answer => answer.teamId),
  }
}
