import { describe, expect, it } from 'vitest'
import { answerRevealModeFromSettings } from './answer-reveal'

describe('answer reveal mode', () => {
  it('supports per-question and end-of-round reveal modes', () => {
    expect(answerRevealModeFromSettings({ answer_reveal: 'each' })).toBe('each')
    expect(answerRevealModeFromSettings({ answer_reveal: 'round' })).toBe('round')
  })

  it('defaults old or malformed settings to per-question reveal', () => {
    expect(answerRevealModeFromSettings(null)).toBe('each')
    expect(answerRevealModeFromSettings({})).toBe('each')
    expect(answerRevealModeFromSettings({ answer_reveal: 'later' })).toBe('each')
  })
})
