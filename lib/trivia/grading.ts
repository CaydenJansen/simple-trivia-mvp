import { answerCandidates, answerVariants } from './answer-variants'

export type ReviewStatus = 'correct' | 'incorrect' | 'review'

export type ReviewReason =
  | 'minor_typo'
  | 'same_characters'
  | 'article_difference'
  | 'close_phrase'

export type ReviewItem = {
  label?: string
  submitted: string
  expected?: string
  status: ReviewStatus
  review_reason?: ReviewReason
}

export type SubmissionGrading = {
  items: ReviewItem[]
  missing?: string[]
}

export type GradingQuestion = {
  question_type: string
  correct_answer: unknown
  accepted_answers?: unknown
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

function compactAnswer(value: string) {
  return value.replace(/\s+/g, '')
}

function editDistance(a: string, b: string, maximum: number) {
  if (Math.abs(a.length - b.length) > maximum) return maximum + 1

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let aIndex = 1; aIndex <= a.length; aIndex += 1) {
    const current = [aIndex]
    let rowMinimum = aIndex

    for (let bIndex = 1; bIndex <= b.length; bIndex += 1) {
      const substitutionCost = a[aIndex - 1] === b[bIndex - 1] ? 0 : 1
      const value = Math.min(
        current[bIndex - 1] + 1,
        previous[bIndex] + 1,
        previous[bIndex - 1] + substitutionCost,
      )
      current.push(value)
      rowMinimum = Math.min(rowMinimum, value)
    }

    if (rowMinimum > maximum) return maximum + 1
    previous = current
  }

  return previous[b.length]
}

function sortedCharacters(value: string) {
  return [...compactAnswer(value)].sort().join('')
}

function withoutLeadingArticle(value: string) {
  return value.replace(/^(?:the|a|an)\s+/u, '')
}

function tokensAppearInOrder(shorter: string, longer: string) {
  const shortTokens = shorter.split(' ').filter(Boolean)
  const longTokens = longer.split(' ').filter(Boolean)
  if (shortTokens.length < 2 || shortTokens.length >= longTokens.length) return false

  let longIndex = 0
  return shortTokens.every(token => {
    const matchIndex = longTokens.indexOf(token, longIndex)
    if (matchIndex < 0) return false
    longIndex = matchIndex + 1
    return true
  })
}

function reviewReasonForPair(normalizedSubmitted: string, normalizedExpected: string): ReviewReason | null {
  if (!normalizedSubmitted || !normalizedExpected || normalizedSubmitted === normalizedExpected) return null

  const submittedCompact = compactAnswer(normalizedSubmitted)
  const expectedCompact = compactAnswer(normalizedExpected)
  const shortestLength = Math.min(submittedCompact.length, expectedCompact.length)
  const longestLength = Math.max(submittedCompact.length, expectedCompact.length)

  if (
    shortestLength >= 3
    && submittedCompact.length === expectedCompact.length
    && sortedCharacters(normalizedSubmitted) === sortedCharacters(normalizedExpected)
  ) return 'same_characters'

  const maximumEdits = longestLength >= 10 ? 2 : 1
  if (shortestLength >= 5 && editDistance(submittedCompact, expectedCompact, maximumEdits) <= maximumEdits) {
    return 'minor_typo'
  }

  if (
    shortestLength >= 4
    && withoutLeadingArticle(normalizedSubmitted) === withoutLeadingArticle(normalizedExpected)
  ) return 'article_difference'

  const shorter = submittedCompact.length <= expectedCompact.length ? submittedCompact : expectedCompact
  const longer = submittedCompact.length > expectedCompact.length ? submittedCompact : expectedCompact
  const shorterNormalized = normalizedSubmitted.length <= normalizedExpected.length
    ? normalizedSubmitted
    : normalizedExpected
  const longerNormalized = normalizedSubmitted.length > normalizedExpected.length
    ? normalizedSubmitted
    : normalizedExpected
  if (
    shorter.length >= 6
    && shorter.length / longer.length >= 0.8
    && (longer.includes(shorter) || tokensAppearInOrder(shorterNormalized, longerNormalized))
  ) return 'close_phrase'

  return null
}

export function reviewReasonLabel(reason: ReviewReason) {
  if (reason === 'same_characters') return 'Same letters, different order'
  if (reason === 'article_difference') return 'Only “the”, “a” or “an” differs'
  if (reason === 'close_phrase') return 'Very close phrase'
  return 'Possible spelling mistake'
}

export function reviewMatchForPair(submitted: string, expected: string): Pick<ReviewItem, 'status' | 'review_reason'> {
  const normalizedSubmitted = normaliseTriviaAnswer(submitted)
  const normalizedExpected = normaliseTriviaAnswer(expected)

  if (normalizedSubmitted && normalizedSubmitted === normalizedExpected) return { status: 'correct' }
  const reviewReason = reviewReasonForPair(normalizedSubmitted, normalizedExpected)
  return reviewReason
    ? { status: 'review', review_reason: reviewReason }
    : { status: 'incorrect' }
}

export function reviewStatusForPair(submitted: string, expected: string): ReviewStatus {
  return reviewMatchForPair(submitted, expected).status
}

function acceptedAnswerGroups(value: unknown): string[][] {
  if (!Array.isArray(value)) return []
  return value.map(item => Array.isArray(item) ? item.map(String) : [String(item)])
}

function bestMatch(submitted: string, expected: string, accepted: string[] = []) {
  const candidates = answerCandidates(expected, accepted)
  const matches = candidates.map(candidate => ({
    expected: candidate,
    ...reviewMatchForPair(submitted, candidate),
  }))
  return matches.find(match => match.status === 'correct')
    ?? matches.find(match => match.status === 'review')
    ?? matches[0]
}

export function buildSubmissionGrading(question: GradingQuestion, answerText: string): SubmissionGrading {
  const parsed = parseStoredAnswer(answerText)

  if (question.question_type === 'single-answer' || question.question_type === 'image-question') {
    const submitted = String(parsed ?? '')
    const expected = String(question.correct_answer ?? '')
    const match = bestMatch(submitted, expected, acceptedAnswerGroups(question.accepted_answers).flat())
    return { items: [{ submitted, expected: match.expected, status: match.status, review_reason: match.review_reason }] }
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
    const acceptedGroups = acceptedAnswerGroups(question.accepted_answers)
    const remaining = asStringArray(question.correct_answer).map(value => ({
      value,
      norm: normaliseTriviaAnswer(value),
      accepted: acceptedGroups.shift() ?? [],
    }))

    const items: ReviewItem[] = submittedRaw.map((submitted) => {
      const norm = normaliseTriviaAnswer(submitted)
      const exactIndex = remaining.findIndex(candidate => norm && answerCandidates(candidate.value, candidate.accepted)
        .some(value => normaliseTriviaAnswer(value) === norm))

      if (exactIndex >= 0) {
        const [match] = remaining.splice(exactIndex, 1)
        return { submitted, expected: match.value, status: 'correct' }
      }

      const nearMatches = remaining.map((candidate, index) => ({
        index,
        candidate,
        match: bestMatch(submitted, candidate.value, candidate.accepted),
      }))
      const near = nearMatches.find(result => result.match.status === 'review')
      if (near) {
        remaining.splice(near.index, 1)
        return {
          submitted,
          expected: near.candidate.value,
          status: 'review',
          review_reason: near.match.review_reason,
        }
      }

      return { submitted, status: 'incorrect' }
    })

    return { items, missing: remaining.map(candidate => answerVariants(candidate.value).primary) }
  }

  if (question.question_type === 'multi-part') {
    const submitted = asStringArray(parsed)
    const expected = asStringArray(question.correct_answer)
    const acceptedGroups = acceptedAnswerGroups(question.accepted_answers)
    return {
      items: expected.map((expectedValue, index) => {
        const submittedValue = submitted[index] ?? ''
        const match = bestMatch(submittedValue, expectedValue, acceptedGroups[index] ?? [])
        return {
          label: String.fromCharCode(65 + index),
          submitted: submittedValue,
          expected: match.status === 'correct' ? match.expected : expectedValue,
          status: match.status,
          review_reason: match.review_reason,
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
        review_reason: item.review_reason,
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
