export const TEAM_NAME_SUGGESTIONS = [
  'Olivia Newton Trivia',
  'The Blim Blams',
  'Dwayne “The Trivia” Johnson',
  'Team Name',
  'Insert lame trivia pun here',
] as const

export function suggestedTeamName(seed: string) {
  const hash = [...seed].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 0)
  return TEAM_NAME_SUGGESTIONS[hash % TEAM_NAME_SUGGESTIONS.length]
}
