import { describe, expect, it } from 'vitest'

import { quizPreviewIndexForKey } from './quiz-preview-navigation'

describe('quiz preview keyboard navigation', () => {
  it('moves forward with spacebar and the right arrow', () => {
    expect(quizPreviewIndexForKey(' ', 'Space', 1, 4)).toBe(2)
    expect(quizPreviewIndexForKey('ArrowRight', 'ArrowRight', 1, 4)).toBe(2)
  })

  it('moves backward with the left arrow and stays within the preview', () => {
    expect(quizPreviewIndexForKey('ArrowLeft', 'ArrowLeft', 2, 4)).toBe(1)
    expect(quizPreviewIndexForKey('ArrowLeft', 'ArrowLeft', 0, 4)).toBe(0)
    expect(quizPreviewIndexForKey('ArrowRight', 'ArrowRight', 3, 4)).toBe(3)
  })

  it('ignores unrelated keys and empty previews', () => {
    expect(quizPreviewIndexForKey('Enter', 'Enter', 0, 4)).toBeNull()
    expect(quizPreviewIndexForKey(' ', 'Space', 0, 0)).toBeNull()
  })
})
