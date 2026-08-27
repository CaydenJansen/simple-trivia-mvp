import { describe, expect, it } from 'vitest'
import {
  AUTO_RUN_CONTENT_SECONDS,
  AUTO_RUN_ROUND_CHECKPOINT_SECONDS,
  autoRunAnswerSeconds,
  autoRunClockLabel,
  autoRunModeFromSettings,
  autoRunRemainingAfterAllLocked,
  autoRunRevealSeconds,
} from './auto-run'

describe('Auto-Run rules', () => {
  it('is opt-in and reads the durable game setting', () => {
    expect(autoRunModeFromSettings(null)).toBe('off')
    expect(autoRunModeFromSettings({ auto_run_mode: 'off' })).toBe('off')
    expect(autoRunModeFromSettings({ auto_run_mode: 'round' })).toBe('round')
  })

  it('adds 15 seconds for every point beyond the first', () => {
    expect(autoRunAnswerSeconds({ points_max: 1 })).toBe(30)
    expect(autoRunAnswerSeconds({ points_max: 3 })).toBe(60)
    expect(autoRunAnswerSeconds({ points_max: 5 })).toBe(90)
  })

  it('times ranking questions by item count', () => {
    expect(autoRunAnswerSeconds({ question_type: 'ranking', points_max: 1, correct_answer: ['A', 'B', 'C', 'D'] })).toBe(45)
  })

  it('drops an open countdown to five seconds when every player is locked in', () => {
    expect(autoRunRemainingAfterAllLocked(42, true)).toBe(5)
    expect(autoRunRemainingAfterAllLocked(3, true)).toBe(3)
    expect(autoRunRemainingAfterAllLocked(42, false)).toBe(42)
  })

  it('allows longer reveals for compound questions', () => {
    expect(autoRunRevealSeconds({ question_type: 'single-answer', correct_answer: 'A' })).toBe(15)
    expect(autoRunRevealSeconds({ question_type: 'multi-part', correct_answer: ['A', 'B', 'C'] })).toBe(25)
  })

  it('keeps fixed content and checkpoint defaults', () => {
    expect(AUTO_RUN_CONTENT_SECONDS).toBe(30)
    expect(AUTO_RUN_ROUND_CHECKPOINT_SECONDS).toBe(60)
    expect(autoRunClockLabel(37)).toBe('00:37')
  })
})
