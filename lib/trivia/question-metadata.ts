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
export type AudienceSuitability = 'family' | 'general' | 'adult'
export type AudienceScope = 'global' | 'country_specific'

export type DiversityMetadata = {
  categories?: readonly string[]
  tags?: readonly string[]
  mechanic?: QuestionMechanic | null
  promptPattern?: string | null
  answerType?: string | null
  editorialDifficulty?: number | null
  hasMedia?: boolean
  stability?: FactualStability | null
  audienceSuitability?: AudienceSuitability | null
  audienceScope?: AudienceScope | null
  audienceLocale?: string | null
  contentFlags?: readonly string[] | null
}

export type EffectiveQuestionPackageMetadata = {
  categories: string[]
  tags: string[]
  difficultyMin: EditorialDifficulty | null
  difficultyMax: EditorialDifficulty | null
  audienceSuitability: AudienceSuitability
  audienceScope: AudienceScope
  audienceLocales: string[]
  contentFlags: string[]
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

function inheritedList(child: readonly string[] | null | undefined, parent: readonly string[] | null | undefined) {
  return child && child.length > 0 ? child : parent ?? []
}

export function resolveInheritedQuestionMetadata(
  parent: DiversityMetadata,
  child: DiversityMetadata,
): DiversityMetadata {
  const audienceScope = child.audienceScope ?? parent.audienceScope ?? 'global'
  return {
    ...child,
    categories: inheritedList(child.categories, parent.categories),
    tags: inheritedList(child.tags, parent.tags),
    promptPattern: child.promptPattern ?? parent.promptPattern ?? null,
    answerType: child.answerType ?? parent.answerType ?? null,
    editorialDifficulty: child.editorialDifficulty ?? parent.editorialDifficulty ?? null,
    stability: child.stability ?? parent.stability ?? 'stable',
    audienceSuitability: child.audienceSuitability ?? parent.audienceSuitability ?? 'general',
    audienceScope,
    audienceLocale: audienceScope === 'country_specific'
      ? child.audienceLocale ?? parent.audienceLocale ?? null
      : null,
    contentFlags: child.contentFlags ?? parent.contentFlags ?? [],
  }
}

export function deriveQuestionPackageMetadata({
  question,
  parts = [],
  bonus = null,
}: {
  question: DiversityMetadata
  parts?: readonly DiversityMetadata[]
  bonus?: DiversityMetadata | null
}): EffectiveQuestionPackageMetadata {
  const base = resolveInheritedQuestionMetadata({}, question)
  const mainComponents = parts.length > 0
    ? parts.map(part => resolveInheritedQuestionMetadata(base, part))
    : [base]
  const components = bonus
    ? [...mainComponents, resolveInheritedQuestionMetadata(base, bonus)]
    : mainComponents
  const difficulties = components
    .map(component => asEditorialDifficulty(component.editorialDifficulty))
    .filter((value): value is EditorialDifficulty => value !== null)
  const suitabilityRank: Record<AudienceSuitability, number> = { family: 0, general: 1, adult: 2 }
  const audienceSuitability = components.reduce<AudienceSuitability>((mostRestrictive, component) => {
    const candidate = component.audienceSuitability ?? 'general'
    return suitabilityRank[candidate] > suitabilityRank[mostRestrictive] ? candidate : mostRestrictive
  }, 'family')
  const countrySpecific = components.filter(component => component.audienceScope === 'country_specific')

  return {
    categories: distinct(components.flatMap(component => component.categories ?? [])),
    tags: distinct(components.flatMap(component => component.tags ?? [])),
    difficultyMin: difficulties.length > 0 ? Math.min(...difficulties) as EditorialDifficulty : null,
    difficultyMax: difficulties.length > 0 ? Math.max(...difficulties) as EditorialDifficulty : null,
    audienceSuitability,
    audienceScope: countrySpecific.length > 0 ? 'country_specific' : 'global',
    audienceLocales: distinct(countrySpecific.flatMap(component => component.audienceLocale ? [component.audienceLocale] : [])),
    contentFlags: distinct(components.flatMap(component => component.contentFlags ?? [])),
  }
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
  const base = resolveInheritedQuestionMetadata({}, question)
  const semanticComponents = parts.length > 0
    ? parts.map(part => resolveInheritedQuestionMetadata(base, part))
    : [base]
  const resolvedBonus = bonus ? resolveInheritedQuestionMetadata(base, bonus) : null
  const diversityComponents = resolvedBonus ? [...semanticComponents, resolvedBonus] : semanticComponents
  const styleComponents = resolvedBonus ? [base, ...semanticComponents, resolvedBonus] : [base, ...semanticComponents]
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
