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

  it('reviews plausible transpositions but rejects wholesale anagrams', () => {
    expect(buildSubmissionGrading(question({ correct_answer: 'George Clooney' }), 'George Clooeny').items[0].status).toBe('review')
    expect(buildSubmissionGrading(question({ correct_answer: 'George Clooney' }), 'Egreog nyoolce').items[0].status).toBe('incorrect')
  })

  it('flags and, ampersand, and plus variants for review', () => {
    expect(buildSubmissionGrading(question({ correct_answer: 'Fast and Furious' }), 'Fast & Furious').items[0]).toMatchObject({
      status: 'review',
      review_reason: 'connector_variant',
    })
    expect(buildSubmissionGrading(question({ correct_answer: 'Fast and Furious' }), 'Fast + Furious').items[0].status).toBe('review')
  })

  it('accepts configured alternative answers', () => {
    expect(buildSubmissionGrading(
      question({ correct_answer: 'William Shakespeare', accepted_answers: ['Shakespeare'] }),
      'shakespeare!',
    ).items[0].status).toBe('correct')
  })

  it('accepts alternatives and notes embedded in legacy answer copy', () => {
    expect(buildSubmissionGrading(
      question({ correct_answer: 'Harley Quinn/ Harleen Quinzel' }),
      'Harley Quinn',
    ).items[0]?.status).toBe('correct')

    expect(buildSubmissionGrading(
      question({ correct_answer: 'Cannes (kan) Film Festival' }),
      'Cannes',
    ).items[0]?.status).toBe('correct')
  })

  it('reviews article-only and close-phrase differences', () => {
    expect(buildSubmissionGrading(
      question({ correct_answer: 'The Great Barrier Reef' }),
      'Great Barrier Reef',
    ).items[0].review_reason).toBe('article_difference')

    expect(buildSubmissionGrading(
      question({ correct_answer: 'Sonic the Hedgehog' }),
      'Sonic Hedgehog',
    ).items[0].review_reason).toBe('close_phrase')
  })

  it('reviews two-character spelling differences only on longer answers', () => {
    expect(buildSubmissionGrading(
      question({ correct_answer: 'Shakespeare' }),
      'Shakspear',
    ).items[0].review_reason).toBe('minor_typo')

    expect(buildSubmissionGrading(
      question({ correct_answer: 'Iran' }),
      'Iraq',
    ).items[0].status).toBe('incorrect')
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

  it('uses per-answer aliases and keeps near matches reviewable without double consumption', () => {
    const result = buildSubmissionGrading(
      question({
        question_type: 'multi-answer',
        correct_answer: ['Belgium', 'Netherlands'],
        accepted_answers: [['Belgique'], ['The Netherlands']],
        points_max: 2,
      }),
      JSON.stringify(['Belgique', 'Netherlans']),
    )

    expect(result.items).toEqual([
      { submitted: 'Belgique', expected: 'Belgium', status: 'correct' },
      {
        submitted: 'Netherlans',
        expected: 'Netherlands',
        status: 'review',
        review_reason: 'minor_typo',
      },
    ])
    expect(result.missing).toEqual([])
    expect(gradingPoints(result, 2)).toBe(1)
  })

  it('accepts a clean response when a legacy expected answer contains a pronunciation note', () => {
    const result = buildSubmissionGrading(
      question({
        question_type: 'multi-answer',
        correct_answer: ['Casino Royale', 'Spectre (spect-tah)'],
        points_max: 2,
      }),
      JSON.stringify(['Casino Royale', 'Spectre']),
    )

    expect(result.items.map(item => item.status)).toEqual(['correct', 'correct'])
    expect(result.missing).toEqual([])
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

  it('accepts alternatives for their specific part only', () => {
    const result = buildSubmissionGrading(
      question({
        question_type: 'multi-part',
        correct_answer: ['Canberra', 'Wellington'],
        accepted_answers: [['ACT'], ['Te Whanganui-a-Tara']],
        points_max: 2,
      }),
      JSON.stringify(['ACT', 'Te Whanganui-a-Tara']),
    )

    expect(result.items.map(item => item.status)).toEqual(['correct', 'correct'])
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
