import { describe, expect, it } from 'vitest'
import {
  buildSubmissionGrading,
  gradingPoints,
  normaliseTriviaAnswer,
  type GradingQuestion,
} from './grading'

function question(overrides: Partial<GradingQuestion>): GradingQuestion {
  return {
    question_type: 'single-answer',
    correct_answer: 'Canada',
    options: null,
    points_max: 1,
    ...overrides,
  }
}

describe('answer normalization', () => {
  it('ignores case, surrounding whitespace, punctuation, and repeated separators', () => {
    expect(normaliseTriviaAnswer('  Sonic: The   Hedgehog! ')).toBe('sonic the hedgehog')
    expect(normaliseTriviaAnswer('CANADA')).toBe(normaliseTriviaAnswer('Canada'))
  })
})

describe('single-answer grading', () => {
  const single = question({})

  it('grades normalized exact answers as correct', () => {
    expect(buildSubmissionGrading(single, ' canada! ').items[0].status).toBe('correct')
  })

  it('grades unrelated answers as incorrect', () => {
    expect(buildSubmissionGrading(single, 'Russia').items[0]).toMatchObject({
      submitted: 'Russia',
      expected: 'Canada',
      status: 'incorrect',
    })
  })

  it('marks a one-edit typo for host review', () => {
    expect(buildSubmissionGrading(single, 'Cannada').items[0].status).toBe('review')
  })
})

describe('multi-answer grading', () => {
  const benelux = question({
    question_type: 'multi-answer',
    correct_answer: ['Belgium', 'Netherlands', 'Luxembourg'],
    points_max: 3,
  })

  it('matches correct answers as an unordered set', () => {
    const result = buildSubmissionGrading(
      benelux,
      JSON.stringify(['Netherlands', 'Luxembourg', 'Belgium']),
    )

    expect(result.items.map(item => item.status)).toEqual(['correct', 'correct', 'correct'])
    expect(result.missing).toEqual([])
    expect(gradingPoints(result, 3)).toBe(3)
  })

  it('does not consume the same expected answer twice', () => {
    const result = buildSubmissionGrading(
      benelux,
      JSON.stringify(['Belgium', 'Belgium', 'Netherlands']),
    )

    expect(result.items.map(item => item.status)).toEqual(['correct', 'incorrect', 'correct'])
    expect(result.items[1]).not.toHaveProperty('expected')
    expect(result.missing).toEqual(['Luxembourg'])
    expect(gradingPoints(result, 3)).toBe(2)
  })

  it('lists missing answers without pairing them to an incorrect submission', () => {
    const result = buildSubmissionGrading(
      benelux,
      JSON.stringify(['Netherlands', 'Belgium', 'France']),
    )

    expect(result.items).toEqual([
      { submitted: 'Netherlands', expected: 'Netherlands', status: 'correct' },
      { submitted: 'Belgium', expected: 'Belgium', status: 'correct' },
      { submitted: 'France', status: 'incorrect' },
    ])
    expect(result.missing).toEqual(['Luxembourg'])
    expect(gradingPoints(result, 3)).toBe(2)
  })
})

describe('multi-part grading', () => {
  it('keeps each response tied to its labelled part', () => {
    const result = buildSubmissionGrading(
      question({
        question_type: 'multi-part',
        correct_answer: ['Sonic the Hedgehog', 'Crash Bandicoot', 'Banjo-Kazooie'],
        points_max: 3,
      }),
      JSON.stringify(['Sonic the Hedgehog', 'Banjo-Kazooie', 'Mario']),
    )

    expect(result.items).toEqual([
      { label: 'A', submitted: 'Sonic the Hedgehog', expected: 'Sonic the Hedgehog', status: 'correct' },
      { label: 'B', submitted: 'Banjo-Kazooie', expected: 'Crash Bandicoot', status: 'incorrect' },
      { label: 'C', submitted: 'Mario', expected: 'Banjo-Kazooie', status: 'incorrect' },
    ])
  })
})

describe('ranking grading', () => {
  it('grades each submitted item against its expected position', () => {
    const result = buildSubmissionGrading(
      question({
        question_type: 'ranking',
        correct_answer: ['Mercury', 'Venus', 'Earth', 'Mars'],
        points_max: 4,
      }),
      JSON.stringify(['Mercury', 'Earth', 'Venus', 'Mars']),
    )

    expect(result.items.map(item => ({
      label: item.label,
      submitted: item.submitted,
      expected: item.expected,
      status: item.status,
    }))).toEqual([
      { label: '1', submitted: 'Mercury', expected: 'Mercury', status: 'correct' },
      { label: '2', submitted: 'Earth', expected: 'Venus', status: 'incorrect' },
      { label: '3', submitted: 'Venus', expected: 'Earth', status: 'incorrect' },
      { label: '4', submitted: 'Mars', expected: 'Mars', status: 'correct' },
    ])
  })
})
