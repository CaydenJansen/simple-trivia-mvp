import { describe, expect, it } from 'vitest'
import { audienceQuestionFromSettings, audienceQuestionSettings } from './audience-question'

describe('audience question settings', () => {
  it('defaults legacy settings to a single host-picked favourite', () => {
    expect(audienceQuestionFromSettings(null)).toEqual({ mode: 'favourite', prompt: '', correctNumber: null, allowMultipleWinners: false })
  })

  it('round-trips closest-number configuration', () => {
    const settings = audienceQuestionSettings({ mode: 'closest-number', prompt: 'How many?', correctNumber: 42, allowMultipleWinners: true })
    expect(audienceQuestionFromSettings(settings)).toEqual({ mode: 'closest-number', prompt: 'How many?', correctNumber: 42, allowMultipleWinners: false })
  })
})
