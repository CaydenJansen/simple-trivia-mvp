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

  it('keeps a normal submitted answer locked while the question remains open', () => {
    expect(playerQuestionStageScreen({ ...base, coreSubmission: { points_awarded: 0 } })).toBe('submitted')
  })

  it('returns a submitted team to the form only when the host deliberately reopens answers', () => {
    expect(playerQuestionStageScreen({ ...base, answerEditingAllowed: true, coreSubmission: { points_awarded: 0 } })).toBe('single-answer')
  })

  it('moves every team to the separately opened bonus stage', () => {
    expect(playerQuestionStageScreen({ ...base, questionStage: 'bonus' })).toBe('bonus-answer')
  })

  it('locks a submitted bonus unless the host deliberately reopens it', () => {
    expect(playerQuestionStageScreen({ ...base, questionStage: 'bonus', bonusSubmission: { points_awarded: 0 } })).toBe('bonus-submitted')
    expect(playerQuestionStageScreen({ ...base, questionStage: 'bonus', answerEditingAllowed: true, bonusSubmission: { points_awarded: 0 } })).toBe('bonus-answer')
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

  it('keeps unresolved Auto-Run grading neutral after reveal', () => {
    expect(playerQuestionStageScreen({
      ...base,
      answerPhase: 'revealed',
      coreSubmission: { points_awarded: 0, is_correct: null },
    })).toBe('pending-review')
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
