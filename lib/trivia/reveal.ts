import {
  scoreSubmission,
  type GradingQuestion,
  type GradingSubmission,
  type SubmissionGrading,
} from './grading'

export type RevealSubmission = GradingSubmission & {
  id: string
  is_correct: boolean | null
}

export type RevealResult = {
  submission_id: string
  is_correct: boolean
  points_awarded: number
  grading_json: SubmissionGrading
}

export function buildRevealResults(
  question: GradingQuestion,
  submissions: RevealSubmission[],
): RevealResult[] {
  return submissions
    .filter(submission => submission.is_correct === null)
    .map((submission) => {
      const result = scoreSubmission(question, submission)
      return {
        submission_id: submission.id,
        is_correct: result.points === result.max,
        points_awarded: result.points,
        grading_json: result.grading,
      }
    })
}

export function buildConfidentRevealResults(
  question: GradingQuestion,
  submissions: RevealSubmission[],
) {
  return buildRevealResults(question, submissions).filter(result =>
    result.grading_json.items.every(item => item.status !== 'review'),
  )
}
