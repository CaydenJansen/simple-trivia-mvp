export type ScoredLeaderboardEntry = {
  score: number
}

export function competitionPlacements<T extends ScoredLeaderboardEntry>(orderedTeams: readonly T[]) {
  return orderedTeams.map((team, index) => (
    index > 0 && orderedTeams[index - 1]?.score === team.score
      ? 0
      : index + 1
  )).map((placement, index, placements) => placement || placements[index - 1] || 1)
}

export function competitionPlacementAt<T extends ScoredLeaderboardEntry>(orderedTeams: readonly T[], index: number) {
  return competitionPlacements(orderedTeams)[index] ?? null
}

export function ordinalPlacement(value: number) {
  const remainder100 = value % 100
  if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`
  if (value % 10 === 1) return `${value}st`
  if (value % 10 === 2) return `${value}nd`
  if (value % 10 === 3) return `${value}rd`
  return `${value}th`
}
