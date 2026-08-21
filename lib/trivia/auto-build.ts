import { AUTO_BUILD_TIEBREAKER_COUNT } from './tiebreakers'

export type AutoBuildQuestion = {
  id: string
  category: string | null
  difficulty: string | null
}

export type AutoBuildTiebreaker = {
  id: string
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

export function buildAutoQuizPlan<
  TQuestion extends AutoBuildQuestion,
  TTiebreaker extends AutoBuildTiebreaker,
>({
  questions,
  tiebreakers,
  questionCount,
  roundTopics,
  difficulties,
  random = Math.random,
}: {
  questions: readonly TQuestion[]
  tiebreakers: readonly TTiebreaker[]
  questionCount: number
  roundTopics: readonly (string | null)[]
  difficulties: readonly string[]
  random?: () => number
}): AutoBuildPlan<TQuestion, TTiebreaker> {
  if (roundTopics.length === 0) throw new Error('Choose at least one round.')
  if (difficulties.length === 0) throw new Error('Choose at least one difficulty.')
  if (tiebreakers.length < AUTO_BUILD_TIEBREAKER_COUNT) {
    throw new Error(`Auto-Build needs at least ${AUTO_BUILD_TIEBREAKER_COUNT} active prepared tiebreakers.`)
  }

  const allowedDifficulties = new Set(difficulties.map(value => value.toLocaleLowerCase()))
  const eligibleQuestions = shuffled(
    questions.filter(question => question.difficulty && allowedDifficulties.has(question.difficulty.toLocaleLowerCase())),
    random,
  )
  const counts = distributeQuestionCount(questionCount, roundTopics.length)
  const usedIds = new Set<string>()

  const rounds = roundTopics.map((topic, roundIndex) => {
    const needed = counts[roundIndex]
    const candidates = eligibleQuestions.filter(question => (
      !usedIds.has(question.id)
      && (topic === null || question.category?.toLocaleLowerCase() === topic.toLocaleLowerCase())
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
    tiebreakers: shuffled(tiebreakers, random).slice(0, AUTO_BUILD_TIEBREAKER_COUNT),
  }
}
