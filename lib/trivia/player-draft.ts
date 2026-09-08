export function savedAnswerForQuestion<T>(
  visibleQuestionKey: string | undefined,
  snapshotQuestionKey: string,
  savedAnswer: T,
): T | null {
  return visibleQuestionKey && visibleQuestionKey === snapshotQuestionKey ? savedAnswer : null
}

const DRAFT_PREFIX = 'simple-trivia-answer-draft'

export function playerDraftStorageKey(gameId: string | null, teamId: string | null, questionKey: string | undefined) {
  if (!gameId || !teamId || !questionKey) return null
  return `${DRAFT_PREFIX}:${gameId}:${teamId}:${questionKey}`
}

export function readPlayerDraft<T>(storage: Pick<Storage, 'getItem'>, key: string | null): T | null {
  if (!key) return null
  try {
    const raw = storage.getItem(key)
    return raw === null ? null : JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writePlayerDraft(storage: Pick<Storage, 'setItem'>, key: string | null, value: unknown) {
  if (!key) return
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Submission must still work when storage is unavailable.
  }
}
