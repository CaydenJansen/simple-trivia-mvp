export type ReviewStatus = 'correct' | 'incorrect' | 'review'

export type ReviewItem = {
  label?: string
  submitted: string
  expected?: string
  status: ReviewStatus
}

export type SubmissionGrading = {
  items: ReviewItem[]
  missing?: string[]
}

export type GradingQuestion = {
  question_type: string
  correct_answer: unknown
  options: unknown
  points_max: number
}

export type GradingSubmission = {
  answer_text: string
  grading_json: SubmissionGrading | null
}

export function normaliseTriviaAnswer(value: string) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function parseStoredAnswer(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : []
}

export function questionOptions(value: unknown): { key?: string; label?: string; clue?: string }[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object') as { key?: string; label?: string; clue?: string }[]
    : []
}

function isOneEditAway(a: string, b: string) {
  if (!a || !b || a === b) return false
  if (Math.abs(a.length - b.length) > 1) return false

  let i = 0
  let j = 0
  let edits = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
      continue
    }

    edits += 1
    if (edits > 1) return false

    if (a.length > b.length) i += 1
    else if (b.length > a.length) j += 1
    else {
      i += 1
      j += 1
    }
  }

  if (i < a.length || j < b.length) edits += 1
  return edits === 1
}

export function reviewStatusForPair(submitted: string, expected: string): ReviewStatus {
  const normalizedSubmitted = normaliseTriviaAnswer(submitted)
  const normalizedExpected = normaliseTriviaAnswer(expected)

  if (normalizedSubmitted && normalizedSubmitted === normalizedExpected) return 'correct'
  if (normalizedSubmitted && normalizedExpected && isOneEditAway(normalizedSubmitted, normalizedExpected)) return 'review'
  return 'incorrect'
}

export function buildSubmissionGrading(question: GradingQuestion, answerText: string): SubmissionGrading {
  const parsed = parseStoredAnswer(answerText)

  if (question.question_type === 'single-answer' || question.question_type === 'image-question') {
    const submitted = String(parsed ?? '')
    const expected = String(question.correct_answer ?? '')
    return { items: [{ submitted, expected, status: reviewStatusForPair(submitted, expected) }] }
  }

  if (question.question_type === 'multiple-choice') {
    const submittedKey = String(parsed ?? '')
    const expectedKey = String(question.correct_answer ?? '')
    const submittedOption = questionOptions(question.options).find(option => option.key === submittedKey)
    const expectedOption = questionOptions(question.options).find(option => option.key === expectedKey)
    return {
      items: [{
        submitted: submittedOption?.label ?? submittedKey,
        expected: expectedOption?.label ?? expectedKey,
        status: submittedKey === expectedKey ? 'correct' : 'incorrect',
      }],
    }
  }

  if (question.question_type === 'multi-answer') {
    const submittedRaw = asStringArray(parsed).filter(value => normaliseTriviaAnswer(value))
    const remaining = asStringArray(question.correct_answer).map(value => ({
      value,
      norm: normaliseTriviaAnswer(value),
    }))

    const items: ReviewItem[] = submittedRaw.map((submitted) => {
      const norm = normaliseTriviaAnswer(submitted)
      const exactIndex = remaining.findIndex(candidate => norm && candidate.norm === norm)

      if (exactIndex >= 0) {
        const [match] = remaining.splice(exactIndex, 1)
        return { submitted, expected: match.value, status: 'correct' }
      }

      const nearIndex = remaining.findIndex(candidate => norm && isOneEditAway(norm, candidate.norm))
      if (nearIndex >= 0) {
        const [match] = remaining.splice(nearIndex, 1)
        return { submitted, expected: match.value, status: 'review' }
      }

      return { submitted, status: 'incorrect' }
    })

    return { items, missing: remaining.map(candidate => candidate.value) }
  }

  if (question.question_type === 'multi-part') {
    const submitted = asStringArray(parsed)
    const expected = asStringArray(question.correct_answer)
    return {
      items: expected.map((expectedValue, index) => {
        const submittedValue = submitted[index] ?? ''
        return {
          label: String.fromCharCode(65 + index),
          submitted: submittedValue,
          expected: expectedValue,
          status: reviewStatusForPair(submittedValue, expectedValue),
        }
      }),
    }
  }

  if (question.question_type === 'ranking') {
    const submitted = asStringArray(parsed)
    const expected = asStringArray(question.correct_answer)
    return {
      items: expected.map((expectedValue, index) => ({
        label: String(index + 1),
        submitted: submitted[index] ?? '',
        expected: expectedValue,
        status: normaliseTriviaAnswer(submitted[index] ?? '') === normaliseTriviaAnswer(expectedValue)
          ? 'correct'
          : 'incorrect',
      })),
    }
  }

  return { items: [] }
}

export function multiAnswerMissing(question: GradingQuestion, grading: SubmissionGrading) {
  if (question.question_type !== 'multi-answer') return []

  const expected = asStringArray(question.correct_answer)
  const remaining = expected.map(value => ({ value, norm: normaliseTriviaAnswer(value) }))

  for (const item of grading.items) {
    if (item.status !== 'correct' && item.status !== 'review') continue

    const expectedNorm = item.expected ? normaliseTriviaAnswer(item.expected) : ''
    let matchIndex = expectedNorm
      ? remaining.findIndex(candidate => candidate.norm === expectedNorm)
      : -1

    if (matchIndex < 0 && item.status === 'correct') {
      const submittedNorm = normaliseTriviaAnswer(item.submitted)
      matchIndex = remaining.findIndex(candidate => submittedNorm && candidate.norm === submittedNorm)
    }

    if (matchIndex >= 0) remaining.splice(matchIndex, 1)
  }

  const resolvedOrPending = grading.items.filter(
    item => item.status === 'correct' || item.status === 'review',
  ).length
  const target = Math.max(1, question.points_max || expected.length || 1)
  const missingCount = Math.max(0, target - resolvedOrPending)

  return remaining.slice(0, missingCount).map(candidate => candidate.value)
}

export function storedSubmissionGrading(
  question: GradingQuestion,
  submission: GradingSubmission,
): SubmissionGrading {
  const stored = submission.grading_json

  if (stored && Array.isArray(stored.items)) {
    const grading: SubmissionGrading = {
      items: stored.items.map((item, index) => ({
        label: item.label ?? String(index + 1),
        submitted: String(item.submitted ?? ''),
        expected: item.expected === undefined ? undefined : String(item.expected),
        status: item.status === 'correct' || item.status === 'review' ? item.status : 'incorrect',
      })),
    }

    if (question.question_type === 'multi-answer') grading.missing = multiAnswerMissing(question, grading)
    return grading
  }

  const grading = buildSubmissionGrading(question, submission.answer_text)
  if (question.question_type === 'multi-answer') grading.missing = multiAnswerMissing(question, grading)
  return grading
}

export function gradingPoints(grading: SubmissionGrading, max: number) {
  return Math.min(
    grading.items.filter(item => item.status === 'correct').length,
    Math.max(1, max || 1),
  )
}

export function scoreSubmission(question: GradingQuestion, submission: GradingSubmission) {
  const max = Math.max(1, question.points_max || 1)
  const grading = storedSubmissionGrading(question, submission)
  return { grading, points: gradingPoints(grading, max), max }
}
