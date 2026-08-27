export type ScoredTeam = {
  id: string
  name: string
  score: number
}

export type ConsequentialTie = {
  score: number
  teamIds: string[]
  topPlaces: number[]
  bottomPlaces: number[]
}

export type TieResolution = {
  score: number
  method: 'tiebreaker' | 'allowed_tie' | 'manual' | 'show_game'
  orderedTeamIds?: string[] | null
}

export type FinalStanding<T extends ScoredTeam = ScoredTeam> = T & {
  placement: number
  bottomPlacement: number
  sortOrder: number
}

function enabledPrizePlaces(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => (
    item && typeof item === 'object' && !Array.isArray(item) && (item as { enabled?: unknown }).enabled === true
      ? [index + 1]
      : []
  ))
}

function scoreGroups<T extends ScoredTeam>(teams: T[]) {
  const sorted = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const groups: T[][] = []
  for (const team of sorted) {
    const current = groups.at(-1)
    if (current?.[0]?.score === team.score) current.push(team)
    else groups.push([team])
  }
  return groups
}

export function consequentialTies(teams: ScoredTeam[], settings: unknown): ConsequentialTie[] {
  const topTargets = new Set([1])
  const bottomTargets = new Set<number>()
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const value = settings as Record<string, unknown>
    enabledPrizePlaces(value.top_prizes).forEach(place => topTargets.add(place))
    enabledPrizePlaces(value.bottom_prizes).forEach(place => bottomTargets.add(place))
  }

  let teamsAbove = 0
  return scoreGroups(teams).flatMap(group => {
    const topPlaces = group.map((_, index) => teamsAbove + index + 1)
    const teamsBelow = teams.length - teamsAbove - group.length
    const bottomPlaces = group.map((_, index) => teamsBelow + index + 1)
    teamsAbove += group.length
    if (group.length < 2) return []
    if (!topPlaces.some(place => topTargets.has(place)) && !bottomPlaces.some(place => bottomTargets.has(place))) return []
    return [{ score: group[0].score, teamIds: group.map(team => team.id), topPlaces, bottomPlaces }]
  })
}

export function buildFinalStandings<T extends ScoredTeam>(teams: T[], resolutions: TieResolution[]): FinalStanding<T>[] {
  const resolutionByScore = new Map(resolutions.map(resolution => [resolution.score, resolution]))
  const standings: FinalStanding<T>[] = []
  let teamsAbove = 0

  for (const group of scoreGroups(teams)) {
    const resolution = resolutionByScore.get(group[0].score)
    const orderedIds = resolution?.method !== 'allowed_tie' ? resolution?.orderedTeamIds ?? [] : []
    const completeOrder = orderedIds.length === group.length
      && new Set(orderedIds).size === group.length
      && group.every(team => orderedIds.includes(team.id))
    const ordered = completeOrder
      ? [...group].sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id))
      : group

    ordered.forEach((team, index) => {
      const separated = completeOrder && resolution?.method !== 'allowed_tie'
      standings.push({
        ...team,
        placement: teamsAbove + (separated ? index : 0) + 1,
        bottomPlacement: teams.length - teamsAbove - (separated ? index : group.length - 1),
        sortOrder: teamsAbove + index + 1,
      })
    })
    teamsAbove += group.length
  }

  return standings
}
