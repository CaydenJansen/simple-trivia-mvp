export function shouldSubmitPlayerAnswerOnEnter({
  key,
  shiftKey,
  isComposing,
  enabled,
}: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  enabled: boolean
}) {
  return key === 'Enter' && !shiftKey && !isComposing && enabled
}
