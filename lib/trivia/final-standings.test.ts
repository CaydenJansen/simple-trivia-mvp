import { describe, expect, it } from 'vitest'
import { buildFinalStandings, consequentialTies } from './final-standings'

const teams = [
  { id: 'a', name: 'A', score: 48 },
  { id: 'b', name: 'B', score: 48 },
  { id: 'c', name: 'C', score: 44 },
  { id: 'd', name: 'D', score: 40 },
]

describe('consequential final ties', () => {
  it('always treats a tie for first as consequential', () => {
    expect(consequentialTies(teams, {})).toEqual([{ score: 48, teamIds: ['a', 'b'], topPlaces: [1, 2], bottomPlaces: [3, 4] }])
  })

  it('also detects ties crossing configured prize placements', () => {
    const middleTie = [
      { id: 'a', name: 'A', score: 5 },
      { id: 'b', name: 'B', score: 4 },
      { id: 'c', name: 'C', score: 4 },
      { id: 'd', name: 'D', score: 1 },
    ]
    expect(consequentialTies(middleTie, { top_prizes: [{ enabled: false }, { enabled: true }] })[0])
      .toMatchObject({ score: 4, teamIds: ['b', 'c'], topPlaces: [2, 3] })
  })

  it('leaves ordinary non-prize ties alone', () => {
    const lowTie = [...teams, { id: 'e', name: 'E', score: 40 }]
    expect(consequentialTies(lowTie, {})).toHaveLength(1)
  })
})

describe('final standings resolution', () => {
  it('orders a resolved tie without changing either score', () => {
    const standings = buildFinalStandings(teams, [{ score: 48, method: 'tiebreaker', orderedTeamIds: ['b', 'a'] }])
    expect(standings.slice(0, 3).map(team => [team.id, team.score, team.placement])).toEqual([
      ['b', 48, 1],
      ['a', 48, 2],
      ['c', 44, 3],
    ])
  })

  it('preserves competition ranking when the host allows a tie', () => {
    const standings = buildFinalStandings(teams, [{ score: 48, method: 'allowed_tie' }])
    expect(standings.map(team => [team.id, team.placement])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
      ['d', 4],
    ])
  })

  it('uses a score-neutral show-game result as a placement order', () => {
    const standings = buildFinalStandings(teams, [{ score: 48, method: 'show_game', orderedTeamIds: ['b', 'a'] }])
    expect(standings.slice(0, 2).map(team => [team.id, team.score, team.placement])).toEqual([
      ['b', 48, 1],
      ['a', 48, 2],
    ])
  })
})
