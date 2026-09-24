import { describe, expect, it } from 'vitest'
import { speedAward, speedClock, speedPointsAvailable, speedScoringEnabled } from './speed-scoring'
import { playerQuestionStageScreen } from './live-bonus-flow'
import { persistentHostGameSettings } from './host-preferences'

describe('speed scoring', () => {
  it('falls continuously from 100 to 50 and clamps clock boundaries', () => {
    expect([-1, 0, 15, 30, 45].map(time => speedPointsAvailable(time, 30))).toEqual([100, 100, 75, 50, 50])
  })
  it('awards proportional partial credit, zero for incorrect answers', () => {
    expect(speedAward(2, 3, 75)).toBe(50)
    expect(speedAward(1, 1, 75)).toBe(75)
    expect(speedAward(0, 5, 100)).toBe(0)
    expect(speedAward(1, 2, 50)).toBe(25)
  })
  it('does not treat a slower correct response as partially correct', () => {
    const result = { answerPhase: 'revealed', questionStage: 'core', baseScreen: 'multi-answer', corePointsMax: 3, bonusPointsMax: 0, bonusSubmission: null, speedScoring: true }
    expect(playerQuestionStageScreen({ ...result, coreSubmission: { is_correct: true, points_awarded: 50 } })).toBe('correct')
    expect(playerQuestionStageScreen({ ...result, coreSubmission: { is_correct: false, points_awarded: 50 } })).toBe('partial-correct')
  })
  it('persists the chosen mode, never a live countdown', () => {
    expect(persistentHostGameSettings({ scoring_mode: 'speed', speed_clock: { key: 'secret' }, auto_run_speed: 'medium' })).toEqual({ scoring_mode: 'speed', auto_run_speed: 'medium' })
    expect(speedScoringEnabled({ scoring_mode: 'speed' })).toBe(true)
    expect(speedScoringEnabled({})).toBe(false)
    expect(speedClock({ scoring_mode: 'classic', speed_clock: { key: 'q', deadline_ms: 100, duration_seconds: 30 } })).toBeNull()
  })
})
