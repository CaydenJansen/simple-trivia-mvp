import { describe, expect, it } from 'vitest'
import { multiAnswerInputCount, playerQuestionStageScreen } from './live-bonus-flow'

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

  it('keeps the main form open when the host reveals the bonus', () => {
    expect(playerQuestionStageScreen({ ...base, questionStage: 'bonus' })).toBe('single-answer')
  })

  it('keeps both forms editable after a bonus submission while answers are open', () => {
    expect(playerQuestionStageScreen({ ...base, questionStage: 'bonus', bonusSubmission: { points_awarded: 0 } })).toBe('single-answer')
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

describe('multi-answer input count', () => {
  it('uses the public points maximum while correct answers are hidden', () => {
    expect(multiAnswerInputCount(5, null)).toBe(5)
  })

  it('never renders fewer boxes than a revealed answer list needs', () => {
    expect(multiAnswerInputCount(3, ['one', 'two', 'three', 'four'])).toBe(4)
  })

  it('always provides at least one answer box', () => {
    expect(multiAnswerInputCount(null, null)).toBe(1)
  })
})
