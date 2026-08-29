import { describe, expect, it } from 'vitest'
import { audienceQuestionFromSettings, audienceQuestionHostInstructions, audienceQuestionPlayerInstructions, audienceQuestionSettings, compareAudienceResponses } from './audience-question'

describe('audience question settings', () => {
  it('defaults legacy settings to a single host-picked favourite', () => {
    expect(audienceQuestionFromSettings(null)).toEqual({ mode: 'favourite', prompt: '', correctNumber: null, allowMultipleWinners: false, shareResponses: false })
  })

  it('round-trips closest-number configuration', () => {
    const settings = audienceQuestionSettings({ mode: 'closest-number', prompt: 'How many?', correctNumber: 42, allowMultipleWinners: true, shareResponses: true })
    expect(audienceQuestionFromSettings(settings)).toEqual({ mode: 'closest-number', prompt: 'How many?', correctNumber: 42, allowMultipleWinners: false, shareResponses: false })
  })

  it('gives each audience-question mode and role useful instructions', () => {
    const favourite = audienceQuestionSettings({ mode: 'favourite', prompt: 'Make us laugh', correctNumber: null, allowMultipleWinners: false, shareResponses: true })
    const closest = audienceQuestionSettings({ mode: 'closest-number', prompt: 'How many?', correctNumber: 42, allowMultipleWinners: false, shareResponses: false })
    expect(audienceQuestionPlayerInstructions(favourite)).toContain('host may pick')
    expect(audienceQuestionHostInstructions(favourite)).toContain('Select your favourite')
    expect(audienceQuestionPlayerInstructions(closest)).toContain('closest answer wins')
    expect(audienceQuestionHostInstructions(closest)).toContain('closest response live')
  })

  it('stores response sharing only for open-ended questions', () => {
    const settings = audienceQuestionSettings({ mode: 'favourite', prompt: 'Make us laugh', correctNumber: null, allowMultipleWinners: false, shareResponses: true })
    expect(audienceQuestionFromSettings(settings).shareResponses).toBe(true)
  })

  it('orders shared responses naturally or by likes without making likes a verdict', () => {
    const early = { submittedAt: '2026-08-30T01:00:00Z', voteCount: 1 }
    const popular = { submittedAt: '2026-08-30T01:01:00Z', voteCount: 4 }
    expect([popular, early].sort((a, b) => compareAudienceResponses(a, b, 'submitted'))).toEqual([early, popular])
    expect([early, popular].sort((a, b) => compareAudienceResponses(a, b, 'votes'))).toEqual([popular, early])
  })
})
