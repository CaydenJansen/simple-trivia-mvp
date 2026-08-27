import { describe, expect, it } from 'vitest'

import { suggestedTeamName, TEAM_NAME_SUGGESTIONS } from './team-name-suggestions'

describe('team-name suggestions', () => {
  it('returns a stable suggestion from the approved list', () => {
    const suggestion = suggestedTeamName('Friday Night Trivia')

    expect(TEAM_NAME_SUGGESTIONS).toContain(suggestion)
    expect(suggestedTeamName('Friday Night Trivia')).toBe(suggestion)
  })

  it('keeps every approved suggestion available', () => {
    expect(TEAM_NAME_SUGGESTIONS).toEqual([
      'Olivia Newton Trivia',
      'The Blim Blams',
      'Dwayne “The Trivia” Johnson',
      'Team Name',
      'Insert lame trivia pun here',
    ])
  })
})
