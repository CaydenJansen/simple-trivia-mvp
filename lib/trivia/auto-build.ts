import { AUTO_BUILD_TIEBREAKER_COUNT } from './tiebreakers'

export type AutoBuildQuestion = {
  id: string
  category: string | null
  difficulty: string | null
  audience_fit?: AutoBuildAudienceFit | null
  adult_content?: boolean | null
  audience_scope?: 'global' | 'country_specific' | null
  audience_locale?: string | null
}

export type AutoBuildTiebreaker = {
  id: string
  audience_fit?: AutoBuildAudienceFit | null
  adult_content?: boolean | null
  audience_scope?: 'global' | 'country_specific' | null
  audience_locale?: string | null
}

export type AutoBuildAudienceFit = 'broad' | 'kids' | 'young_adults' | 'older_adults'
export type AutoBuildScopeMode = 'global_only' | 'include_locale'

export type AutoBuildContentSettings = {
  audienceFit: AutoBuildAudienceFit
  allowAdultContent: boolean
  scopeMode: AutoBuildScopeMode
  locale: string
}

export type AutoBuildRound<TQuestion extends AutoBuildQuestion> = {
  title: string
  questions: TQuestion[]
}

export type AutoBuildPlan<
  TQuestion extends AutoBuildQuestion,
  TTiebreaker extends AutoBuildTiebreaker,
> = {
  rounds: AutoBuildRound<TQuestion>[]
  tiebreakers: TTiebreaker[]
}

export type AutoBuildShortage = {
  topic: string | null
  available: number
  required: number
}

export type AutoBuildAvailability = {
  canBuild: boolean
  matchingQuestionCount: number
  shortages: AutoBuildShortage[]
}

export function distributeQuestionCount(questionCount: number, roundCount: number) {
  if (!Number.isInteger(questionCount) || questionCount < 1) {
    throw new Error('Question count must be a positive whole number.')
  }
  if (!Number.isInteger(roundCount) || roundCount < 1) {
    throw new Error('Round count must be a positive whole number.')
  }

  const base = Math.floor(questionCount / roundCount)
  const remainder = questionCount % roundCount
  return Array.from({ length: roundCount }, (_, index) => base + (index < remainder ? 1 : 0))
}

function shuffled<T>(items: readonly T[], random: () => number) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = current
  }
  return result
}

function normalizedLocale(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? ''
}

function matchesContentSettings(
  item: Pick<AutoBuildQuestion, 'adult_content' | 'audience_scope' | 'audience_locale'>,
  settings?: AutoBuildContentSettings,
) {
  if (!settings) return true
  if (!settings.allowAdultContent && item.adult_content === true) return false

  const scope = item.audience_scope ?? 'global'
  if (scope === 'global') return true
  if (settings.scopeMode === 'global_only') return false

  const requestedLocale = normalizedLocale(settings.locale)
  return requestedLocale.length > 0 && normalizedLocale(item.audience_locale) === requestedLocale
}

function audiencePreferenceRank(
  item: Pick<AutoBuildQuestion, 'audience_fit'>,
  settings?: AutoBuildContentSettings,
) {
  if (!settings) return 0
  const fit = item.audience_fit ?? 'broad'
  if (fit === settings.audienceFit) return 0
  if (fit === 'broad') return 1
  return 2
}

function withAudiencePreference<T extends Pick<AutoBuildQuestion, 'audience_fit'>>(
  items: T[],
  settings?: AutoBuildContentSettings,
) {
  return settings
    ? items.sort((a, b) => audiencePreferenceRank(a, settings) - audiencePreferenceRank(b, settings))
    : items
}

export function getEligibleAutoBuildTiebreakers<TTiebreaker extends AutoBuildTiebreaker>(
  tiebreakers: readonly TTiebreaker[],
  contentSettings?: AutoBuildContentSettings,
) {
  return tiebreakers.filter(tiebreaker => matchesContentSettings(tiebreaker, contentSettings))
}

export function getAutoBuildAvailability({
  questions,
  questionCount,
  roundTopics,
  difficulties,
  contentSettings,
}: {
  questions: readonly AutoBuildQuestion[]
  questionCount: number
  roundTopics: readonly (string | null)[]
  difficulties: readonly string[]
  contentSettings?: AutoBuildContentSettings
}): AutoBuildAvailability {
  if (roundTopics.length === 0) throw new Error('Choose at least one round.')
  if (difficulties.length === 0) throw new Error('Choose at least one difficulty.')

  const allowedDifficulties = new Set(difficulties.map(value => value.toLocaleLowerCase()))
  const eligibleQuestions = questions.filter(question => (
    question.difficulty && allowedDifficulties.has(question.difficulty.toLocaleLowerCase())
  )).filter(question => matchesContentSettings(question, contentSettings))
  const requirements = new Map<string, { topic: string | null; required: number }>()

  distributeQuestionCount(questionCount, roundTopics.length).forEach((needed, roundIndex) => {
    const topic = roundTopics[roundIndex]
    const key = topic?.toLocaleLowerCase() ?? '__mixed__'
    const current = requirements.get(key)
    requirements.set(key, { topic, required: (current?.required ?? 0) + needed })
  })

  let matchingQuestionCount = 0
  const shortages: AutoBuildShortage[] = []
  requirements.forEach(({ topic, required }) => {
    const available = eligibleQuestions.filter(question => (
      topic === null
      || topic.toLocaleLowerCase() === 'general knowledge'
      || question.category?.toLocaleLowerCase() === topic.toLocaleLowerCase()
    )).length
    matchingQuestionCount += available
    if (available < required) shortages.push({ topic, available, required })
  })

  return {
    canBuild: shortages.length === 0,
    matchingQuestionCount,
    shortages,
  }
}

export function buildAutoQuizPlan<
  TQuestion extends AutoBuildQuestion,
  TTiebreaker extends AutoBuildTiebreaker,
>({
  questions,
  tiebreakers,
  questionCount,
  roundTopics,
  difficulties,
  contentSettings,
  random = Math.random,
}: {
  questions: readonly TQuestion[]
  tiebreakers: readonly TTiebreaker[]
  questionCount: number
  roundTopics: readonly (string | null)[]
  difficulties: readonly string[]
  contentSettings?: AutoBuildContentSettings
  random?: () => number
}): AutoBuildPlan<TQuestion, TTiebreaker> {
  if (roundTopics.length === 0) throw new Error('Choose at least one round.')
  if (difficulties.length === 0) throw new Error('Choose at least one difficulty.')
  if (questionCount < roundTopics.length) throw new Error('Add at least one question for every round.')
  const eligibleTiebreakers = getEligibleAutoBuildTiebreakers(tiebreakers, contentSettings)
  if (eligibleTiebreakers.length < AUTO_BUILD_TIEBREAKER_COUNT) {
    throw new Error(contentSettings
      ? `Question Library has ${eligibleTiebreakers.length} prepared tiebreakers matching these advanced settings, but Auto-Build needs ${AUTO_BUILD_TIEBREAKER_COUNT}.`
      : `Auto-Build needs at least ${AUTO_BUILD_TIEBREAKER_COUNT} active prepared tiebreakers.`)
  }

  const availability = getAutoBuildAvailability({ questions, questionCount, roundTopics, difficulties, contentSettings })
  const firstShortage = availability.shortages[0]
  if (firstShortage) {
    const label = firstShortage.topic ?? 'the selected mix'
    throw new Error(`Question Library has ${firstShortage.available} matching questions for ${label}, but this quiz needs ${firstShortage.required}.`)
  }

  const allowedDifficulties = new Set(difficulties.map(value => value.toLocaleLowerCase()))
  const eligibleQuestions = withAudiencePreference(shuffled(
    questions
      .filter(question => question.difficulty && allowedDifficulties.has(question.difficulty.toLocaleLowerCase()))
      .filter(question => matchesContentSettings(question, contentSettings)),
    random,
  ), contentSettings)
  const counts = distributeQuestionCount(questionCount, roundTopics.length)
  const usedIds = new Set<string>()

  const rounds = roundTopics.map((topic, roundIndex) => {
    const needed = counts[roundIndex]
    const candidates = eligibleQuestions.filter(question => (
      !usedIds.has(question.id)
      && (
        topic === null
        || topic.toLocaleLowerCase() === 'general knowledge'
        || question.category?.toLocaleLowerCase() === topic.toLocaleLowerCase()
      )
    ))

    if (candidates.length < needed) {
      const label = topic ?? 'the selected mix'
      throw new Error(`Question Library has ${candidates.length} matching questions for ${label}, but this round needs ${needed}.`)
    }

    const selected = candidates.slice(0, needed)
    selected.forEach(question => usedIds.add(question.id))
    return {
      title: topic ?? `Round ${roundIndex + 1}`,
      questions: selected,
    }
  })

  return {
    rounds,
    tiebreakers: withAudiencePreference(
      shuffled(eligibleTiebreakers, random),
      contentSettings,
    ).slice(0, AUTO_BUILD_TIEBREAKER_COUNT),
  }
}
