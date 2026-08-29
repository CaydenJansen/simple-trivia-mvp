import { describe, expect, it } from 'vitest'
import { audienceQuestionFromSettings, audienceQuestionHostInstructions, audienceQuestionPlayerInstructions, audienceQuestionSettings } from './audience-question'

describe('audience question settings', () => {
  it('defaults legacy settings to a single host-picked favourite', () => {
    expect(audienceQuestionFromSettings(null)).toEqual({ mode: 'favourite', prompt: '', correctNumber: null, allowMultipleWinners: false })
  })

  it('round-trips closest-number configuration', () => {
    const settings = audienceQuestionSettings({ mode: 'closest-number', prompt: 'How many?', correctNumber: 42, allowMultipleWinners: true })
    expect(audienceQuestionFromSettings(settings)).toEqual({ mode: 'closest-number', prompt: 'How many?', correctNumber: 42, allowMultipleWinners: false })
  })

  it('gives each audience-question mode and role useful instructions', () => {
    const favourite = audienceQuestionSettings({ mode: 'favourite', prompt: 'Make us laugh', correctNumber: null, allowMultipleWinners: false })
    const closest = audienceQuestionSettings({ mode: 'closest-number', prompt: 'How many?', correctNumber: 42, allowMultipleWinners: false })
    expect(audienceQuestionPlayerInstructions(favourite)).toContain('host may pick')
    expect(audienceQuestionHostInstructions(favourite)).toContain('Select your favourite')
    expect(audienceQuestionPlayerInstructions(closest)).toContain('closest answer wins')
    expect(audienceQuestionHostInstructions(closest)).toContain('closest response live')
  })
})
