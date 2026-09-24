export const TRIVIA_DIFFICULTIES = ['Very Easy', 'Easy', 'Medium', 'Hard', 'Very Hard'] as const

export type TriviaDifficulty = typeof TRIVIA_DIFFICULTIES[number]

export type TriviaDifficultyTone = 'very-easy' | 'easy' | 'medium' | 'hard' | 'very-hard'

export function isTriviaDifficulty(value: string): value is TriviaDifficulty {
  return (TRIVIA_DIFFICULTIES as readonly string[]).includes(value)
}

export function triviaDifficultyTone(value: string): TriviaDifficultyTone | 'unrated' {
  if (value === 'Very Easy') return 'very-easy'
  if (value === 'Easy') return 'easy'
  if (value === 'Medium') return 'medium'
  if (value === 'Hard') return 'hard'
  if (value === 'Very Hard') return 'very-hard'
  return 'unrated'
}

export function effectiveTriviaDifficulty(
  observedDifficulty: number | null | undefined,
  editorialDifficulty: number | null | undefined,
  fallback = 'Unrated',
): TriviaDifficulty | string {
  const level = observedDifficulty ?? editorialDifficulty
  if (Number.isInteger(level) && level !== null && level !== undefined && level >= 1 && level <= 5) {
    return TRIVIA_DIFFICULTIES[level - 1]
  }
  return fallback
}
