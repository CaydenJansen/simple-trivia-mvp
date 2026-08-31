import { describe, expect, it } from 'vitest'
import {
  AUTO_RUN_CONTENT_SECONDS,
  AUTO_RUN_ROUND_CHECKPOINT_SECONDS,
  autoRunAnswerSeconds,
  autoRunClockColor,
  autoRunClockFromSettings,
  autoRunClockLabel,
  autoRunModeFromSettings,
  autoRunScaledSeconds,
  autoRunSpeedFromSettings,
  autoRunShowGameResultSeconds,
  autoRunShouldAdvanceShowGameResult,
  autoRunRemainingAfterAllLocked,
  autoRunRevealSeconds,
} from './auto-run'

describe('Auto-Run rules', () => {
  it('is opt-in and reads the durable game setting', () => {
    expect(autoRunModeFromSettings(null)).toBe('off')
    expect(autoRunModeFromSettings({ auto_run_mode: 'off' })).toBe('off')
    expect(autoRunModeFromSettings({ auto_run_mode: 'round' })).toBe('round')
  })

  it('uses persistent fast, medium, and slow pacing', () => {
    expect(autoRunSpeedFromSettings(null)).toBe('fast')
    expect(autoRunSpeedFromSettings({ auto_run_speed: 'medium' })).toBe('medium')
    expect(autoRunSpeedFromSettings({ auto_run_speed: 'slow' })).toBe('slow')
    expect(autoRunScaledSeconds(20, 'fast')).toBe(20)
    expect(autoRunScaledSeconds(20, 'medium')).toBe(24)
    expect(autoRunScaledSeconds(20, 'slow')).toBe(28)
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

  it('uses short workload-based reveals capped at ten seconds', () => {
    expect(autoRunRevealSeconds({ question_type: 'single-answer', correct_answer: 'A' })).toBe(5)
    expect(autoRunRevealSeconds({ question_type: 'multi-part', correct_answer: ['A', 'B', 'C'] })).toBe(9)
    expect(autoRunRevealSeconds({ question_type: 'multi-answer', correct_answer: ['A', 'B', 'C', 'D', 'E'] })).toBe(10)
  })

  it('keeps fixed content and checkpoint defaults', () => {
    expect(AUTO_RUN_CONTENT_SECONDS).toBe(30)
    expect(AUTO_RUN_ROUND_CHECKPOINT_SECONDS).toBe(60)
    expect(autoRunClockLabel(37)).toBe('00:37')
  })

  it('pauses completed in-show tiebreakers for host review', () => {
    expect(autoRunShowGameResultSeconds('spin-the-wheel')).toBe(10)
    expect(autoRunShouldAdvanceShowGameResult('spin-the-wheel')).toBe(true)
    expect(autoRunShowGameResultSeconds('in-show-tiebreaker')).toBe(0)
    expect(autoRunShouldAdvanceShowGameResult('in-show-tiebreaker')).toBe(false)
  })

  it('reads a synchronized running or paused player clock', () => {
    expect(autoRunClockFromSettings({ auto_run_clock: { key: 'q1', label: 'Answers close in', deadline_ms: 15_000, paused_remaining: null } }, 10_000)).toEqual({
      key: 'q1', label: 'Answers close in', remaining: 5, paused: false,
    })
    expect(autoRunClockFromSettings({ auto_run_clock: { key: 'q1', label: 'Answers close in', deadline_ms: null, paused_remaining: 8 } }, 10_000)).toEqual({
      key: 'q1', label: 'Answers close in', remaining: 8, paused: true,
    })
    expect(autoRunClockFromSettings({ auto_run_clock: { key: 'q1', label: 'Answers close in', deadline_ms: 9_000, paused_remaining: null } }, 10_000)).toBeNull()
  })

  it('uses orange for the final ten seconds and red for the final five', () => {
    expect(autoRunClockColor(11)).toBe('#7C3AED')
    expect(autoRunClockColor(10)).toBe('#D97706')
    expect(autoRunClockColor(5)).toBe('#DC2626')
  })
})
