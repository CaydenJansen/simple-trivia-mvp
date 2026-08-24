import { describe, expect, it } from 'vitest'

import {
  type ImportSheetName,
  type QuestionLibraryWorkbook,
  type WorkbookRow,
  validateQuestionLibraryWorkbook,
} from './question-library-import'

const HEADERS: Record<ImportSheetName, string[]> = {
  Questions: [
    'import_key', 'prompt', 'mechanic', 'answer', 'accepted_answers', 'primary_category',
    'secondary_categories', 'topic_tags', 'prompt_pattern', 'answer_type', 'difficulty',
    'stability', 'as_of_date', 'review_due_at', 'valid_from', 'expires_at', 'image_url',
    'image_alt', 'notes', 'status', 'source_name', 'source_url', 'source_checked_date',
  ],
  'Question Items': [
    'question_import_key', 'item_kind', 'position', 'label', 'display_text', 'clue',
    'correct_answer', 'accepted_answers', 'is_correct', 'primary_category',
    'secondary_categories', 'topic_tags', 'prompt_pattern', 'answer_type', 'difficulty',
    'stability', 'image_url',
  ],
  Bonuses: [
    'question_import_key', 'prompt', 'correct_answer', 'accepted_answers', 'points',
    'primary_category', 'secondary_categories', 'topic_tags', 'prompt_pattern', 'answer_type',
    'difficulty', 'stability', 'image_url', 'image_alt', 'notes', 'source_name', 'source_url',
    'source_checked_date',
  ],
  Tiebreakers: [
    'import_key', 'prompt', 'correct_numeric_answer', 'answer_unit', 'notes', 'status',
    'source_name', 'source_url', 'source_checked_date',
  ],
  Tags: ['slug', 'name', 'parent_tag', 'specificity', 'diversity_weight', 'aliases', 'active'],
}

function row(rowNumber: number, values: Record<string, unknown>): WorkbookRow {
  return { rowNumber, values }
}

function sheet(name: ImportSheetName, rows: WorkbookRow[]) {
  return { headers: HEADERS[name], rows }
}

function baseQuestion(importKey: string, values: Record<string, unknown>) {
  return row(2, {
    import_key: importKey,
    prompt: 'Question prompt?',
    mechanic: 'single-answer',
    answer: 'Answer',
    accepted_answers: 'Alias',
    primary_category: 'science-nature',
    secondary_categories: '',
    topic_tags: 'science',
    prompt_pattern: 'identify-from-clue',
    answer_type: 'term',
    difficulty: 2,
    stability: 'stable',
    as_of_date: '',
    review_due_at: '',
    valid_from: '',
    expires_at: '',
    image_url: '',
    image_alt: '',
    notes: '',
    status: 'needs_review',
    source_name: 'Reference',
    source_url: 'https://example.com/source',
    source_checked_date: '2026-08-24',
    ...values,
  })
}

function item(rowNumber: number, values: Record<string, unknown>) {
  return row(rowNumber, {
    question_import_key: '',
    item_kind: '',
    position: rowNumber - 1,
    label: '',
    display_text: '',
    clue: '',
    correct_answer: '',
    accepted_answers: '',
    is_correct: false,
    primary_category: '',
    secondary_categories: '',
    topic_tags: '',
    prompt_pattern: '',
    answer_type: '',
    difficulty: '',
    stability: 'stable',
    image_url: '',
    ...values,
  })
}

function validWorkbook(): QuestionLibraryWorkbook {
  const questions = [
    baseQuestion('single-1', { prompt: 'Which planet is red?', answer: 'Mars', accepted_answers: 'The Red Planet', topic_tags: 'science|space' }),
    { ...baseQuestion('choice-1', {}), rowNumber: 3, values: { ...baseQuestion('choice-1', {}).values, prompt: 'Capital of Canada?', mechanic: 'multiple-choice', answer: '', accepted_answers: '', primary_category: 'geography', topic_tags: 'geography', prompt_pattern: 'which-of-the-following', answer_type: 'city' } },
    { ...baseQuestion('multi-answer-1', {}), rowNumber: 4, values: { ...baseQuestion('multi-answer-1', {}).values, prompt: 'Name the Benelux countries.', mechanic: 'multi-answer', answer: '', accepted_answers: '', primary_category: 'geography', topic_tags: 'geography', prompt_pattern: 'list-answers', answer_type: 'country' } },
    { ...baseQuestion('multi-part-1', {}), rowNumber: 5, values: { ...baseQuestion('multi-part-1', {}).values, prompt: 'Answer each clue.', mechanic: 'multi-part', answer: '', accepted_answers: '', primary_category: '', topic_tags: '', answer_type: '', difficulty: '', prompt_pattern: 'match-clue-answer' } },
    { ...baseQuestion('ranking-1', {}), rowNumber: 6, values: { ...baseQuestion('ranking-1', {}).values, prompt: 'Order the planets.', mechanic: 'ranking', answer: '', accepted_answers: '', topic_tags: 'science|space', prompt_pattern: 'ranking-ordering', answer_type: 'place' } },
  ]

  const items = [
    item(2, { question_import_key: 'choice-1', item_kind: 'choice', position: 1, label: 'A', display_text: 'Toronto', is_correct: false }),
    item(3, { question_import_key: 'choice-1', item_kind: 'choice', position: 2, label: 'B', display_text: 'Ottawa', is_correct: true }),
    item(4, { question_import_key: 'choice-1', item_kind: 'choice', position: 3, label: 'C', display_text: 'Vancouver', is_correct: false }),
    item(5, { question_import_key: 'choice-1', item_kind: 'choice', position: 4, label: 'D', display_text: 'Montreal', is_correct: false }),
    item(6, { question_import_key: 'multi-answer-1', item_kind: 'answer', position: 1, correct_answer: 'Belgium' }),
    item(7, { question_import_key: 'multi-answer-1', item_kind: 'answer', position: 2, correct_answer: 'Netherlands', accepted_answers: 'The Netherlands' }),
    item(8, { question_import_key: 'multi-answer-1', item_kind: 'answer', position: 3, correct_answer: 'Luxembourg' }),
    item(9, { question_import_key: 'multi-part-1', item_kind: 'part', position: 1, label: 'A', clue: 'Physics clue', correct_answer: 'Einstein', primary_category: 'science-nature', topic_tags: 'science', prompt_pattern: 'identify-from-clue', answer_type: 'person', difficulty: 2 }),
    item(10, { question_import_key: 'multi-part-1', item_kind: 'part', position: 2, label: 'B', clue: 'Literature clue', correct_answer: 'Orwell', primary_category: 'arts-literature', topic_tags: 'literature', prompt_pattern: 'identify-from-clue', answer_type: 'person', difficulty: 3 }),
    item(11, { question_import_key: 'ranking-1', item_kind: 'ranking_item', position: 1, display_text: 'Mercury' }),
    item(12, { question_import_key: 'ranking-1', item_kind: 'ranking_item', position: 2, display_text: 'Venus' }),
    item(13, { question_import_key: 'ranking-1', item_kind: 'ranking_item', position: 3, display_text: 'Earth' }),
  ]

  return {
    Questions: sheet('Questions', questions),
    'Question Items': sheet('Question Items', items),
    Bonuses: sheet('Bonuses', [row(2, {
      question_import_key: 'single-1',
      prompt: 'Which Roman god gives Mars its name?',
      correct_answer: 'Mars',
      accepted_answers: 'The god Mars',
      points: 1,
      primary_category: 'history',
      secondary_categories: 'society-culture',
      topic_tags: 'history',
      prompt_pattern: 'person-identification',
      answer_type: 'person',
      difficulty: 2,
      stability: 'stable',
      image_url: '', image_alt: '', notes: '',
      source_name: 'Reference', source_url: 'https://example.com/bonus', source_checked_date: '2026-08-24',
    })]),
    Tiebreakers: sheet('Tiebreakers', [row(2, {
      import_key: 'tie-1', prompt: 'How long is the wall?', correct_numeric_answer: 21196,
      answer_unit: 'kilometres', notes: '', status: 'needs_review', source_name: 'Reference',
      source_url: 'https://example.com/tie', source_checked_date: '2026-08-24',
    })]),
    Tags: sheet('Tags', [
      row(2, { slug: 'science', name: 'Science', parent_tag: '', specificity: 1, diversity_weight: 1, aliases: '', active: true }),
      row(3, { slug: 'space', name: 'Space', parent_tag: 'science', specificity: 2, diversity_weight: 1.5, aliases: 'outer space', active: true }),
      row(4, { slug: 'geography', name: 'Geography', parent_tag: '', specificity: 1, diversity_weight: 1, aliases: '', active: true }),
      row(5, { slug: 'literature', name: 'Literature', parent_tag: '', specificity: 2, diversity_weight: 1, aliases: '', active: true }),
      row(6, { slug: 'history', name: 'History', parent_tag: '', specificity: 1, diversity_weight: 1, aliases: '', active: true }),
    ]),
  }
}

describe('Question Library workbook validation', () => {
  it('normalizes every supported mechanic, a bonus, tiebreaker and controlled tags', () => {
    const result = validateQuestionLibraryWorkbook(validWorkbook())

    expect(result.valid).toBe(true)
    expect(result.issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(result.plan?.questions).toHaveLength(5)
    expect(result.plan?.questions.find(question => question.importKey === 'choice-1')).toMatchObject({
      correctAnswer: 'B',
      options: [
        { key: 'A', label: 'Toronto' },
        { key: 'B', label: 'Ottawa' },
        { key: 'C', label: 'Vancouver' },
        { key: 'D', label: 'Montreal' },
      ],
    })
    expect(result.plan?.questions.find(question => question.importKey === 'multi-answer-1')).toMatchObject({
      correctAnswer: ['Belgium', 'Netherlands', 'Luxembourg'],
      acceptedAnswers: [[], ['The Netherlands'], []],
    })
    expect(result.plan?.questions.find(question => question.importKey === 'multi-part-1')?.parts).toHaveLength(2)
    expect(result.plan?.questions.find(question => question.importKey === 'ranking-1')?.correctAnswer).toEqual(['Mercury', 'Venus', 'Earth'])
    expect(result.plan?.questions[0].bonus?.points).toBe(1)
    expect(result.plan?.tiebreakers[0].correctValue).toBe(21196)
  })

  it('rejects example rows so sample content cannot be published accidentally', () => {
    const workbook = validWorkbook()
    workbook.Questions!.rows[0].values.notes = 'EXAMPLE — delete before import'

    const result = validateQuestionLibraryWorkbook(workbook)

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'example_row', sheet: 'Questions', row: 2 }))
  })

  it('rejects active content because publishing is a separate editorial decision', () => {
    const workbook = validWorkbook()
    workbook.Questions!.rows[0].values.status = 'active'

    const result = validateQuestionLibraryWorkbook(workbook)

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'unsafe_status' }))
  })

  it('rejects duplicate normalized multi-answer values', () => {
    const workbook = validWorkbook()
    const answerRows = workbook['Question Items']!.rows.filter(value => value.values.question_import_key === 'multi-answer-1')
    answerRows[1].values.correct_answer = ' Belgium! '

    const result = validateQuestionLibraryWorkbook(workbook)

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'duplicate_answer' }))
  })

  it('rejects orphaned child rows and duplicate bonus rows', () => {
    const workbook = validWorkbook()
    workbook['Question Items']!.rows.push(item(20, { question_import_key: 'missing-question', item_kind: 'answer', correct_answer: 'No parent' }))
    workbook.Bonuses!.rows.push({ ...workbook.Bonuses!.rows[0], rowNumber: 3 })

    const result = validateQuestionLibraryWorkbook(workbook)

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_parent', sheet: 'Question Items' }),
      expect.objectContaining({ code: 'duplicate_bonus', sheet: 'Bonuses' }),
    ]))
  })

  it('defaults parent audience metadata and preserves blank child fields as inheritance', () => {
    const workbook = validWorkbook()
    workbook.Questions!.headers.push('audience_suitability', 'audience_scope', 'audience_locale', 'content_flags')
    workbook.Bonuses!.headers.push('audience_suitability', 'audience_scope', 'audience_locale', 'content_flags')
    Object.assign(workbook.Questions!.rows[0].values, {
      audience_suitability: 'family',
      audience_scope: 'global',
      audience_locale: '',
      content_flags: '',
    })
    Object.assign(workbook.Bonuses!.rows[0].values, {
      primary_category: '',
      secondary_categories: '',
      topic_tags: '',
      prompt_pattern: '',
      answer_type: '',
      difficulty: '',
      stability: '',
      audience_suitability: 'adult',
      audience_scope: 'country_specific',
      audience_locale: 'Australia',
      content_flags: 'violence|death',
    })

    const result = validateQuestionLibraryWorkbook(workbook)

    expect(result.valid).toBe(true)
    expect(result.plan?.questions[0]).toMatchObject({
      audienceSuitability: 'family',
      audienceScope: 'global',
      audienceLocale: null,
      contentFlags: [],
      bonus: {
        primaryCategory: null,
        editorialDifficulty: null,
        stability: null,
        audienceSuitability: 'adult',
        audienceScope: 'country_specific',
        audienceLocale: 'Australia',
        contentFlags: ['violence', 'death'],
      },
    })
  })

  it('rejects a country-specific audience without a locale', () => {
    const workbook = validWorkbook()
    workbook.Questions!.headers.push('audience_suitability', 'audience_scope', 'audience_locale', 'content_flags')
    Object.assign(workbook.Questions!.rows[0].values, {
      audience_scope: 'country_specific',
      audience_locale: '',
    })

    const result = validateQuestionLibraryWorkbook(workbook)

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'required_with_scope' }))
  })

  it('rejects a workbook with a renamed or deleted required header', () => {
    const workbook = validWorkbook()
    workbook.Questions!.headers = workbook.Questions!.headers.filter(header => header !== 'import_key')

    const result = validateQuestionLibraryWorkbook(workbook)

    expect(result.valid).toBe(false)
    expect(result.plan).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_header', column: 'import_key' }))
  })
})
