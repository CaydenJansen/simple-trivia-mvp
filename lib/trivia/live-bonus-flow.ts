export type LiveAnswerPhase = 'open' | 'closed' | 'revealed'
export type LiveQuestionStage = 'core' | 'bonus'

type ScoredSubmission = { points_awarded?: number | null } | null

export function playerQuestionStageScreen(input: {
  answerPhase: string | null
  questionStage: string | null
  baseScreen: string
  coreSubmission: ScoredSubmission
  bonusSubmission: ScoredSubmission
  corePointsMax: number
  bonusPointsMax: number
}) {
  const {
    answerPhase,
    questionStage,
    baseScreen,
    coreSubmission,
    bonusSubmission,
    corePointsMax,
    bonusPointsMax,
  } = input

  if (answerPhase === 'revealed') {
    if (!coreSubmission && !bonusSubmission) return 'no-answer'
    const points = (coreSubmission?.points_awarded ?? 0) + (bonusSubmission?.points_awarded ?? 0)
    const max = Math.max(1, corePointsMax) + Math.max(0, bonusPointsMax)
    if (points <= 0) return 'incorrect'
    if (points < max) return 'partial-correct'
    return 'correct'
  }

  if (answerPhase === 'closed') return coreSubmission || bonusSubmission ? 'submitted' : 'no-answer'
  // Revealing a bonus adds it to the existing question form. The ordinary
  // answer stays visible and editable until the host closes both together.
  if (questionStage === 'bonus') return baseScreen
  return baseScreen
}

export function multiAnswerInputCount(pointsMax: number | null | undefined, correctAnswer: unknown) {
  const revealedAnswerCount = Array.isArray(correctAnswer) ? correctAnswer.length : 0
  const safePointsMax = Number.isFinite(pointsMax) ? Math.floor(Number(pointsMax)) : 0
  return Math.max(1, safePointsMax, revealedAnswerCount)
}
