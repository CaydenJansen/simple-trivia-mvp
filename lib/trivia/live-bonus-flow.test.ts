import { describe, expect, it } from 'vitest'
import { playerQuestionStageScreen } from './live-bonus-flow'

const base = {
  answerPhase: 'open',
  questionStage: 'core',
  baseScreen: 'single-answer',
  coreSubmission: null,
  bonusSubmission: null,
  corePointsMax: 1,
  bonusPointsMax: 2,
}

describe('live bonus stage flow', () => {
  it('starts on the ordinary question screen', () => {
    expect(playerQuestionStageScreen(base)).toBe('single-answer')
  })

  it('keeps a submitted main answer locked while waiting for the bonus', () => {
    expect(playerQuestionStageScreen({ ...base, coreSubmission: { points_awarded: 0 } })).toBe('submitted')
  })

  it('moves every team to the host-opened bonus stage', () => {
    expect(playerQuestionStageScreen({ ...base, questionStage: 'bonus' })).toBe('bonus-answer')
  })

  it('locks a submitted bonus until the host closes both stages', () => {
    expect(playerQuestionStageScreen({ ...base, questionStage: 'bonus', bonusSubmission: { points_awarded: 0 } })).toBe('bonus-submitted')
  })

  it('uses combined main and bonus points at reveal without changing their question identity', () => {
    expect(playerQuestionStageScreen({
      ...base,
      answerPhase: 'revealed',
      coreSubmission: { points_awarded: 1 },
      bonusSubmission: { points_awarded: 0 },
    })).toBe('partial-correct')

    expect(playerQuestionStageScreen({
      ...base,
      answerPhase: 'revealed',
      coreSubmission: { points_awarded: 1 },
      bonusSubmission: { points_awarded: 2 },
    })).toBe('correct')
  })
})
