import { describe, expect, it } from 'vitest'
import { submittedAnswersEditableFromSettings } from './answer-editing'

describe('submitted answer editing settings', () => {
  it('locks submitted answers by default', () => {
    expect(submittedAnswersEditableFromSettings(null)).toBe(false)
    expect(submittedAnswersEditableFromSettings({})).toBe(false)
  })

  it('allows changes only when the host explicitly enables them', () => {
    expect(submittedAnswersEditableFromSettings({ submitted_answers_editable: true })).toBe(true)
    expect(submittedAnswersEditableFromSettings({ submitted_answers_editable: false })).toBe(false)
  })
})
