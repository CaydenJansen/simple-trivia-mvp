import { describe, expect, it } from 'vitest'

import { playerDraftStorageKey, readPlayerDraft, savedAnswerForQuestion, writePlayerDraft } from './player-draft'

describe('player draft restoration', () => {
  it('restores a saved answer only for the question that owns it', () => {
    expect(savedAnswerForQuestion('q1', 'q1', 'Brisbane')).toBe('Brisbane')
    expect(savedAnswerForQuestion('q2', 'q1', 'Brisbane')).toBeNull()
  })

  it('does not expose a previous answer while the next question is hydrating', () => {
    expect(savedAnswerForQuestion('q2', 'q1', ['old', 'answers'])).toBeNull()
    expect(savedAnswerForQuestion(undefined, 'q1', 'old answer')).toBeNull()
  })

  it('persists a draft separately for each game, team, and question', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    const key = playerDraftStorageKey('game-1', 'team-1', 'question-1')
    writePlayerDraft(storage, key, ['first', 'partial'])
    expect(readPlayerDraft<string[]>(storage, key)).toEqual(['first', 'partial'])
    expect(readPlayerDraft(storage, playerDraftStorageKey('game-1', 'team-1', 'question-2'))).toBeNull()
  })
})
