export const TRIVIA_DIFFICULTIES = ['Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard'] as const

export type TriviaDifficulty = typeof TRIVIA_DIFFICULTIES[number]

export function isTriviaDifficulty(value: string): value is TriviaDifficulty {
  return (TRIVIA_DIFFICULTIES as readonly string[]).includes(value)
}
