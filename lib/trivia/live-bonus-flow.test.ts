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

  it('returns a submitted team to the editable main form whenever answers are open', () => {
    expect(playerQuestionStageScreen({ ...base, coreSubmission: { points_awarded: 0 } })).toBe('single-answer')
  })

  it('moves every team to the host-opened bonus stage', () => {
    expect(playerQuestionStageScreen({ ...base, questionStage: 'bonus' })).toBe('bonus-answer')
  })

  it('returns a submitted team to the editable bonus form whenever bonus answers are open', () => {
    expect(playerQuestionStageScreen({ ...base, questionStage: 'bonus', bonusSubmission: { points_awarded: 0 } })).toBe('bonus-answer')
  })

  it('locks submitted answers when the host closes the question', () => {
    expect(playerQuestionStageScreen({
      ...base,
      answerPhase: 'closed',
      coreSubmission: { points_awarded: 0 },
    })).toBe('submitted')
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
