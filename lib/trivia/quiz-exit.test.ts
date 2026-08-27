import { describe, expect, it } from 'vitest'
import { quizExitPrompt } from './quiz-exit'

describe('quiz exit prompts', () => {
  it('offers to discard an entirely new quiz even before further edits', () => {
    expect(quizExitPrompt({ newQuiz: true, dirty: false })).toBe('discard-quiz')
  })

  it('offers to discard changes only when an existing quiz was edited', () => {
    expect(quizExitPrompt({ newQuiz: false, dirty: true })).toBe('discard-changes')
  })

  it('lets an unchanged saved quiz exit without a prompt', () => {
    expect(quizExitPrompt({ newQuiz: false, dirty: false })).toBeNull()
  })
})
