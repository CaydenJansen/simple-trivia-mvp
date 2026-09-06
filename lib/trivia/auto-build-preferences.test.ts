import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_BUILD_PREFERENCES,
  loadAutoBuildPreferences,
  normalizeAutoBuildDifficultyRange,
  parseAutoBuildPreferences,
} from './auto-build-preferences'

describe('Auto-Build preferences', () => {
  it('restores Include games and the related reward settings', () => {
    expect(parseAutoBuildPreferences({
      includeGames: true,
      gameRewardType: 'custom',
      gamePrize: 'A magnificent hat',
      roundCount: 3,
      topics: ['Sport'],
    })).toMatchObject({
      includeGames: true,
      gameRewardType: 'custom',
      gamePrize: 'A magnificent hat',
      topics: ['Sport', 'Film & Television', 'Sport'],
    })
  })

  it('clamps unsafe numeric values and fills missing round topics', () => {
    expect(parseAutoBuildPreferences({ questionCount: 500, roundCount: 2, difficulty: [3, 1] })).toMatchObject({
      questionCount: 100,
      roundCount: 2,
      difficulty: [3, 4],
      topics: ['General Knowledge', 'Film & Television'],
    })
  })

  it('always restores at least two adjacent difficulty levels', () => {
    expect(normalizeAutoBuildDifficultyRange(0, 0)).toEqual([0, 1])
    expect(normalizeAutoBuildDifficultyRange(2, 2)).toEqual([2, 3])
    expect(normalizeAutoBuildDifficultyRange(4, 4)).toEqual([3, 4])
    expect(normalizeAutoBuildDifficultyRange(1, 3)).toEqual([1, 3])
  })

  it('falls back safely when stored JSON is invalid', () => {
    expect(loadAutoBuildPreferences('{not json')).toEqual(DEFAULT_AUTO_BUILD_PREFERENCES)
  })

  it('restores the newer vibe filters', () => {
    expect(parseAutoBuildPreferences({ vibe: 'uber_dweeb' }).vibe).toBe('uber_dweeb')
    expect(parseAutoBuildPreferences({ vibe: 'pop_head' }).vibe).toBe('pop_head')
  })
})
