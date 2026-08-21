export const SOURCE_QUESTION_CATEGORIES = [
  'Geography',
  'History',
  'Science & Nature',
  'Sport',
  'Music',
  'Film & Television',
  'Arts & Literature',
  'Food & Drink',
  'Society & Culture',
  'Language & Words',
  'Technology & Inventions',
  'Games & Leisure',
  'Business & Brands',
  'Politics & Government',
] as const

export type SourceQuestionCategory = (typeof SOURCE_QUESTION_CATEGORIES)[number]
export type EditorialDifficulty = 1 | 2 | 3 | 4 | 5
export type QuestionMechanic =
  | 'single-answer'
  | 'multiple-choice'
  | 'multi-answer'
  | 'multi-part'
  | 'ranking'
export type FactualStability = 'stable' | 'review_periodically' | 'volatile'

export type DiversityMetadata = {
  categories?: readonly string[]
  tags?: readonly string[]
  mechanic?: QuestionMechanic | null
  promptPattern?: string | null
  answerType?: string | null
  editorialDifficulty?: number | null
  hasMedia?: boolean
  stability?: FactualStability | null
}

export type DiversityFingerprint = {
  categories: string[]
  tags: string[]
  mechanics: QuestionMechanic[]
  promptPatterns: string[]
  answerTypes: string[]
  difficultyMin: EditorialDifficulty | null
  difficultyMax: EditorialDifficulty | null
  hasMedia: boolean
  hasBonus: boolean
  stabilities: FactualStability[]
}

function distinct<T>(values: readonly T[]) {
  return [...new Set(values)]
}

function asEditorialDifficulty(value: number | null | undefined): EditorialDifficulty | null {
  return Number.isInteger(value) && value !== undefined && value !== null && value >= 1 && value <= 5
    ? value as EditorialDifficulty
    : null
}

export function mechanicFromLegacyQuestionType(value: string): QuestionMechanic | null {
  if (value === 'image-question') return 'single-answer'
  if (
    value === 'single-answer'
    || value === 'multiple-choice'
    || value === 'multi-answer'
    || value === 'multi-part'
    || value === 'ranking'
  ) return value
  return null
}

export function editorialDifficultyFromLegacy(value: string | null | undefined): EditorialDifficulty | null {
  const normalized = value?.trim().toLocaleLowerCase()
  if (normalized === 'very easy') return 1
  if (normalized === 'easy') return 2
  if (normalized === 'medium') return 3
  if (normalized === 'hard') return 4
  if (normalized === 'very hard') return 5
  return null
}

export function isSourceQuestionCategory(value: string): value is SourceQuestionCategory {
  return (SOURCE_QUESTION_CATEGORIES as readonly string[]).includes(value)
}

export function deriveMultiPartSummary(parts: readonly DiversityMetadata[]) {
  const difficulties = parts
    .map(part => asEditorialDifficulty(part.editorialDifficulty))
    .filter((value): value is EditorialDifficulty => value !== null)

  return {
    categories: distinct(parts.flatMap(part => part.categories ?? [])),
    tags: distinct(parts.flatMap(part => part.tags ?? [])),
    difficultyMin: difficulties.length > 0 ? Math.min(...difficulties) as EditorialDifficulty : null,
    difficultyMax: difficulties.length > 0 ? Math.max(...difficulties) as EditorialDifficulty : null,
  }
}

export function buildDiversityFingerprint({
  question,
  parts = [],
  bonus = null,
}: {
  question: DiversityMetadata
  parts?: readonly DiversityMetadata[]
  bonus?: DiversityMetadata | null
}): DiversityFingerprint {
  const semanticComponents = parts.length > 0 ? parts : [question]
  const diversityComponents = bonus ? [...semanticComponents, bonus] : semanticComponents
  const styleComponents = bonus ? [question, ...parts, bonus] : [question, ...parts]
  const difficulties = diversityComponents
    .map(component => asEditorialDifficulty(component.editorialDifficulty))
    .filter((value): value is EditorialDifficulty => value !== null)

  return {
    categories: distinct(diversityComponents.flatMap(component => component.categories ?? [])),
    tags: distinct(diversityComponents.flatMap(component => component.tags ?? [])),
    mechanics: distinct(styleComponents.flatMap(component => component.mechanic ? [component.mechanic] : [])),
    promptPatterns: distinct(styleComponents.flatMap(component => component.promptPattern ? [component.promptPattern] : [])),
    answerTypes: distinct(styleComponents.flatMap(component => component.answerType ? [component.answerType] : [])),
    difficultyMin: difficulties.length > 0 ? Math.min(...difficulties) as EditorialDifficulty : null,
    difficultyMax: difficulties.length > 0 ? Math.max(...difficulties) as EditorialDifficulty : null,
    hasMedia: styleComponents.some(component => component.hasMedia),
    hasBonus: bonus !== null,
    stabilities: distinct(styleComponents.flatMap(component => component.stability ? [component.stability] : [])),
  }
}
