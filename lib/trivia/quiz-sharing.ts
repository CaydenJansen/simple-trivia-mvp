export const QUIZ_SHARE_QUERY_PARAM = 'share'

export function buildQuizShareUrl(origin: string, token: string) {
  const url = new URL('/host', origin)
  url.searchParams.set(QUIZ_SHARE_QUERY_PARAM, token)
  return url.toString()
}

export function quizShareTokenFromUrl(value: string) {
  try {
    return new URL(value).searchParams.get(QUIZ_SHARE_QUERY_PARAM)?.trim() || null
  } catch {
    return null
  }
}

export function removeQuizShareToken(value: string) {
  const url = new URL(value)
  url.searchParams.delete(QUIZ_SHARE_QUERY_PARAM)
  return url.toString()
}

export function quizShareClaimError(message: string) {
  if (message.includes('SHARE_OWN_QUIZ')) return 'You already own this quiz.'
  if (message.includes('SHARE_LINK_INVALID')) return 'This share link has expired or been revoked.'
  return 'Could not add this quiz. Check your connection and try again.'
}
