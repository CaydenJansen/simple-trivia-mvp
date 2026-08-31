import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_BUILD_PREFERENCES,
  loadAutoBuildPreferences,
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
      difficulty: [3, 3],
      topics: ['General Knowledge', 'Film & Television'],
    })
  })

  it('falls back safely when stored JSON is invalid', () => {
    expect(loadAutoBuildPreferences('{not json')).toEqual(DEFAULT_AUTO_BUILD_PREFERENCES)
  })
})
