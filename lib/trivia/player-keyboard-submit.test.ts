import { describe, expect, it } from 'vitest'
import { shouldSubmitPlayerAnswerOnEnter } from './player-keyboard-submit'

describe('player answer keyboard submission', () => {
  it('submits an enabled answer when Return is pressed', () => {
    expect(shouldSubmitPlayerAnswerOnEnter({ key: 'Enter', shiftKey: false, isComposing: false, enabled: true })).toBe(true)
  })

  it('keeps Shift+Return available for a newline', () => {
    expect(shouldSubmitPlayerAnswerOnEnter({ key: 'Enter', shiftKey: true, isComposing: false, enabled: true })).toBe(false)
  })

  it('does not submit blank, busy, composing, or unrelated key presses', () => {
    expect(shouldSubmitPlayerAnswerOnEnter({ key: 'Enter', shiftKey: false, isComposing: false, enabled: false })).toBe(false)
    expect(shouldSubmitPlayerAnswerOnEnter({ key: 'Enter', shiftKey: false, isComposing: true, enabled: true })).toBe(false)
    expect(shouldSubmitPlayerAnswerOnEnter({ key: 'ArrowRight', shiftKey: false, isComposing: false, enabled: true })).toBe(false)
  })
})
