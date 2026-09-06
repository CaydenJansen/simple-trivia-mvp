import type {
  AutoBuildAudiencePreference,
  AutoBuildScopeMode,
  AutoBuildVibe,
} from './auto-build'
import type { ShowGameRewardType } from './show-game-rewards'

export const AUTO_BUILD_PREFERENCES_KEY = 'good-trivia-auto-build-preferences-v1'

export type AutoBuildPreferences = {
  mode: 'mixed' | 'custom'
  difficulty: [number, number]
  questionCount: number
  roundCount: number
  includeGames: boolean
  includeTiebreaker: boolean
  tiebreakerMode: 'in-show' | 'backup'
  gameRewardType: ShowGameRewardType
  gameRewardPoints: number
  gamePrize: string
  topics: string[]
  audienceFit: AutoBuildAudiencePreference
  vibe: AutoBuildVibe
  allowAdultContent: boolean
  scopeMode: AutoBuildScopeMode
  audienceLocale: string
}

export const DEFAULT_AUTO_BUILD_PREFERENCES: AutoBuildPreferences = {
  mode: 'mixed',
  difficulty: [0, 4],
  questionCount: 30,
  roundCount: 4,
  includeGames: false,
  includeTiebreaker: true,
  tiebreakerMode: 'in-show',
  gameRewardType: 'points',
  gameRewardPoints: 1,
  gamePrize: '',
  topics: ['General Knowledge', 'Film & Television', 'Sport', 'Music'],
  audienceFit: 'all',
  vibe: 'none',
  allowAdultContent: false,
  scopeMode: 'global_only',
  audienceLocale: '',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, Number(value))) : fallback
}

export function normalizeAutoBuildDifficultyRange(minimum: unknown, maximum: unknown): [number, number] {
  const safeMinimum = boundedInteger(minimum, 0, 0, 4)
  const safeMaximum = boundedInteger(maximum, 4, 0, 4)
  if (safeMaximum > safeMinimum) return [safeMinimum, safeMaximum]
  return safeMinimum >= 4 ? [3, 4] : [safeMinimum, safeMinimum + 1]
}

export function parseAutoBuildPreferences(value: unknown): AutoBuildPreferences {
  const stored = record(value)
  const roundCount = boundedInteger(stored.roundCount, DEFAULT_AUTO_BUILD_PREFERENCES.roundCount, 1, 10)
  const rawDifficulty = Array.isArray(stored.difficulty) ? stored.difficulty : []
  const [difficultyMinimum, difficultyMaximum] = normalizeAutoBuildDifficultyRange(rawDifficulty[0], rawDifficulty[1])
  const storedTopics = Array.isArray(stored.topics)
    ? stored.topics.filter((topic): topic is string => typeof topic === 'string' && topic.length > 0)
    : []

  return {
    mode: stored.mode === 'custom' ? 'custom' : 'mixed',
    difficulty: [difficultyMinimum, difficultyMaximum],
    questionCount: boundedInteger(stored.questionCount, DEFAULT_AUTO_BUILD_PREFERENCES.questionCount, 1, 100),
    roundCount,
    includeGames: stored.includeGames === true,
    includeTiebreaker: stored.includeTiebreaker !== false,
    tiebreakerMode: stored.tiebreakerMode === 'backup' ? 'backup' : 'in-show',
    gameRewardType: stored.gameRewardType === 'custom' ? 'custom' : 'points',
    gameRewardPoints: boundedInteger(stored.gameRewardPoints, 1, 1, 100),
    gamePrize: typeof stored.gamePrize === 'string' ? stored.gamePrize : '',
    topics: Array.from({ length: roundCount }, (_, index) => storedTopics[index] ?? DEFAULT_AUTO_BUILD_PREFERENCES.topics[index] ?? 'General Knowledge'),
    audienceFit: ['broad', 'kids', 'young_adults', 'older_adults'].includes(String(stored.audienceFit))
      ? stored.audienceFit as AutoBuildAudiencePreference : 'all',
    vibe: ['guys_wearing_hats', 'oh_look_a_butterfly', 'uber_dweeb', 'pop_head'].includes(String(stored.vibe))
      ? stored.vibe as AutoBuildVibe : 'none',
    allowAdultContent: stored.allowAdultContent === true,
    scopeMode: stored.scopeMode === 'include_locale' ? 'include_locale' : 'global_only',
    audienceLocale: typeof stored.audienceLocale === 'string' ? stored.audienceLocale : '',
  }
}

export function loadAutoBuildPreferences(storageValue: string | null): AutoBuildPreferences {
  if (!storageValue) return DEFAULT_AUTO_BUILD_PREFERENCES
  try {
    return parseAutoBuildPreferences(JSON.parse(storageValue))
  } catch {
    return DEFAULT_AUTO_BUILD_PREFERENCES
  }
}
