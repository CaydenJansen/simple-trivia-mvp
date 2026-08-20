import { describe, expect, it } from 'vitest'
import { hostRecoveryScreen } from './session-recovery'

describe('host session recovery', () => {
  it('restores a lobby', () => {
    expect(hostRecoveryScreen('lobby', 'lobby')).toBe('lobby')
  })

  it('restores active question and content screens to the live console', () => {
    expect(hostRecoveryScreen('live', 'single-answer')).toBe('live-question')
    expect(hostRecoveryScreen('live', 'content-screen')).toBe('live-question')
    expect(hostRecoveryScreen('live', 'round-start')).toBe('live-question')
  })

  it('restores round results and delayed reveals to the round console', () => {
    expect(hostRecoveryScreen('live', 'round-results')).toBe('end-of-round')
    expect(hostRecoveryScreen('finished', 'delayed-reveal')).toBe('end-of-round')
  })

  it('restores completed games to final results', () => {
    expect(hostRecoveryScreen('finished', 'final-result')).toBe('final-results')
  })

  it('falls back safely when no live state is recognizable', () => {
    expect(hostRecoveryScreen(null, null)).toBe('dashboard')
  })
})
