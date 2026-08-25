import { describe, expect, it } from 'vitest'

import { nextQuizCopyTitle } from './quiz-copy'

describe('quiz copy titles', () => {
  it('uses a clear copy suffix', () => {
    expect(nextQuizCopyTitle('Friday Quiz', [])).toBe('Friday Quiz copy')
  })

  it('increments repeated copies case-insensitively', () => {
    expect(nextQuizCopyTitle('Friday Quiz', [
      'Friday Quiz copy',
      'FRIDAY QUIZ COPY 2',
    ])).toBe('Friday Quiz copy 3')
  })
})
