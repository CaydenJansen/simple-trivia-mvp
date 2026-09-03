export function savedAnswerForQuestion<T>(
  visibleQuestionKey: string | undefined,
  snapshotQuestionKey: string,
  savedAnswer: T,
): T | null {
  return visibleQuestionKey && visibleQuestionKey === snapshotQuestionKey ? savedAnswer : null
}
