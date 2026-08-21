export const MANUAL_TIEBREAKER_RECOMMENDATION = 2
export const AUTO_BUILD_TIEBREAKER_COUNT = 3

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

export function isValidTiebreakerNumericValue(value: string) {
  return DECIMAL_NUMBER.test(value.trim())
}

export function needsMoreManualTiebreakers(count: number) {
  return count < MANUAL_TIEBREAKER_RECOMMENDATION
}

export function hasRequiredAutoBuildTiebreakers(count: number) {
  return count === AUTO_BUILD_TIEBREAKER_COUNT
}
