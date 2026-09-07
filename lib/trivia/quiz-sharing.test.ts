import { describe, expect, it } from 'vitest'

import {
  buildQuizShareUrl,
  quizShareClaimError,
  quizShareTokenFromUrl,
  removeQuizShareToken,
} from './quiz-sharing'

describe('quiz sharing URLs', () => {
  it('builds a host link containing only the share token', () => {
    expect(buildQuizShareUrl('https://goodtrivia.example/something', 'abc-123'))
      .toBe('https://goodtrivia.example/host?share=abc-123')
  })

  it('reads and removes share tokens without disturbing other parameters', () => {
    const url = 'https://goodtrivia.example/host?share=abc-123&from=email'
    expect(quizShareTokenFromUrl(url)).toBe('abc-123')
    expect(removeQuizShareToken(url)).toBe('https://goodtrivia.example/host?from=email')
  })

  it('turns server claim failures into useful messages', () => {
    expect(quizShareClaimError('SHARE_OWN_QUIZ')).toBe('You already own this quiz.')
    expect(quizShareClaimError('SHARE_LINK_INVALID')).toContain('expired or been revoked')
    expect(quizShareClaimError('network unavailable')).toContain('Check your connection')
  })
})
