import { describe, expect, it } from 'vitest'

import {
  QUESTION_LIBRARY_COLUMNS,
  type QuestionLibraryWorkbook,
  type WorkbookRow,
  importPlanCounts,
  validateQuestionLibraryWorkbook,
} from './question-library-import'

function row(rowNumber: number, values: Record<string, unknown>): WorkbookRow {
  return { rowNumber, values }
}

function validWorkbook(): QuestionLibraryWorkbook {
  return {
    Questions: {
      headers: [...QUESTION_LIBRARY_COLUMNS.Questions],
      rows: [
        row(2, { 'Question ID': 'Q001', 'Row Type': 'Question', 'Prompt / Clue': 'What is the capital of Canada?', Answer: 'Ottawa', 'Accepted Answers': 'Ottawa ; ottawa', Category: 'Geography', Difficulty: 2, Tags: 'Canada; National Capitals', 'Audience Fit': 'Broad', 'Adult Content?': 'No', Scope: 'Global' }),
        row(3, { 'Question ID': 'Q002', 'Row Type': 'Question', 'Prompt / Clue': 'Which planet is red?', Category: 'Science & Nature', Difficulty: 1 }),
        row(4, { 'Question ID': 'Q002', 'Row Type': 'Choice', Label: 'A', 'Prompt / Clue': 'Venus' }),
        row(5, { 'Question ID': 'Q002', 'Row Type': 'Choice', Label: 'B', 'Prompt / Clue': 'Mars', 'Correct Choice?': 'Yes' }),
        row(6, { 'Question ID': 'Q003', 'Row Type': 'Question', 'Prompt / Clue': 'Name the Benelux countries.', Category: 'Geography', Difficulty: 2 }),
        row(7, { 'Question ID': 'Q003', 'Row Type': 'Answer', Answer: 'Belgium' }),
        row(8, { 'Question ID': 'Q003', 'Row Type': 'Answer', Answer: 'Netherlands' }),
        row(9, { 'Question ID': 'Q003', 'Row Type': 'Answer', Answer: 'Luxembourg' }),
        row(10, { 'Question ID': 'Q004', 'Row Type': 'Question', 'Prompt / Clue': 'Identify these people.', Tags: 'Pop Culture' }),
        row(11, { 'Question ID': 'Q004', 'Row Type': 'Part', Label: 'A', 'Prompt / Clue': 'Relativity scientist', Answer: 'Albert Einstein', Category: 'Science & Nature', Difficulty: 2, Tags: 'Physics' }),
        row(12, { 'Question ID': 'Q004', 'Row Type': 'Part', Label: 'B', 'Prompt / Clue': 'Author of 1984', Answer: 'George Orwell', Category: 'Arts & Literature', Difficulty: 3, Tags: 'Orwell' }),
        row(13, { 'Question ID': 'Q004', 'Row Type': 'Bonus', 'Prompt / Clue': 'Which book follows New Moon?', Answer: 'Eclipse', Category: 'Arts & Literature', Difficulty: 2, Tags: 'Twilight Saga' }),
        row(14, { 'Question ID': 'Q005', 'Row Type': 'Question', 'Prompt / Clue': 'Rank closest to furthest.', Category: 'Science & Nature', Difficulty: 2 }),
        row(15, { 'Question ID': 'Q005', 'Row Type': 'Ranking', Label: 1, 'Prompt / Clue': 'Mercury' }),
        row(16, { 'Question ID': 'Q005', 'Row Type': 'Ranking', Label: 2, 'Prompt / Clue': 'Venus' }),
      ],
    },
    Tiebreakers: {
      headers: [...QUESTION_LIBRARY_COLUMNS.Tiebreakers],
      rows: [row(2, { 'Tiebreaker ID': 'TB001', Prompt: 'How long is the Great Wall?', 'Correct Numeric Answer': 21196, Unit: 'km', Category: 'Geography', Difficulty: 4 })],
    },
  }
}

describe('long-format Question Library imports', () => {
  it('infers mechanics, inheritance and structured answers', () => {
    const result = validateQuestionLibraryWorkbook(validWorkbook())
    expect(result.valid).toBe(true)
    expect(result.plan?.questions.map(question => question.mechanic)).toEqual([
      'single-answer', 'multiple-choice', 'multi-answer', 'multi-part', 'ranking',
    ])
    expect(result.plan?.questions[0].acceptedAnswers).toEqual([])
    expect(result.plan?.questions[1]).toMatchObject({ correctAnswer: 'B', options: [{ key: 'A', label: 'Venus' }, { key: 'B', label: 'Mars' }] })
    expect(result.plan?.questions[2].correctAnswer).toEqual(['Belgium', 'Netherlands', 'Luxembourg'])
    expect(result.plan?.questions[3].parts[0]).toMatchObject({ primaryCategory: 'science-nature', editorialDifficulty: 2, tagPhrases: ['Physics'], tagMode: 'add' })
    expect(result.plan?.questions[3].bonus).toMatchObject({ primaryCategory: 'arts-literature', tagPhrases: ['Twilight Saga'], tagMode: 'replace' })
    expect(result.plan?.questions[4].correctAnswer).toEqual(['Mercury', 'Venus'])
    expect(result.plan?.tiebreakers[0]).toMatchObject({ correctValue: 21196, audienceFit: 'broad', adultContent: false, audienceScope: 'global' })
  })

  it('keeps unknown tags as warnings instead of invalidating questions', () => {
    const result = validateQuestionLibraryWorkbook(validWorkbook())
    expect(result.valid).toBe(true)
    expect(result.issues.filter(issue => issue.code === 'proposed_tag').map(issue => issue.message)).toEqual([
      '“Orwell” will be preserved for bulk tag review if the database does not recognize it.',
      '“Twilight Saga” will be preserved for bulk tag review if the database does not recognize it.',
    ])
    expect(result.plan && importPlanCounts(result.plan)).toMatchObject({ proposedTagPhrases: 2 })
  })

  it('supports the older Correct? and Adult? header labels while the template is updated', () => {
    const workbook = validWorkbook()
    workbook.Questions!.headers = workbook.Questions!.headers.map(header => header === 'Correct Choice?' ? 'Correct?' : header === 'Adult Content?' ? 'Adult?' : header)
    workbook.Questions!.rows[3].values['Correct?'] = 'Yes'
    delete workbook.Questions!.rows[3].values['Correct Choice?']
    workbook.Questions!.rows[0].values['Adult?'] = 'No'
    delete workbook.Questions!.rows[0].values['Adult Content?']
    expect(validateQuestionLibraryWorkbook(workbook).valid).toBe(true)
  })

  it('rejects contradictory structures and duplicate multi-answer values', () => {
    const workbook = validWorkbook()
    workbook.Questions!.rows.splice(5, 0, row(7, { 'Question ID': 'Q002', 'Row Type': 'Part', Label: 'A', 'Prompt / Clue': 'Clue', Answer: 'Answer' }))
    workbook.Questions!.rows[7].values.Answer = ' belgium '
    const result = validateQuestionLibraryWorkbook(workbook)
    expect(result.valid).toBe(false)
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['contradictory_structure', 'duplicate_answer']))
  })

  it('rejects separated groups, invalid rankings, duplicate bonuses and incomplete locality', () => {
    const workbook = validWorkbook()
    workbook.Questions!.rows.push(row(17, { 'Question ID': 'Q001', 'Row Type': 'Bonus', 'Prompt / Clue': 'Bonus?', Answer: 'Answer' }))
    workbook.Questions!.rows[14].values.Label = 3
    workbook.Questions!.rows.splice(13, 0, row(14, { 'Question ID': 'Q004', 'Row Type': 'Bonus', 'Prompt / Clue': 'Another bonus?', Answer: 'No' }))
    workbook.Questions!.rows[0].values.Scope = 'Country-specific'
    workbook.Questions!.rows[0].values.Locale = ''
    const result = validateQuestionLibraryWorkbook(workbook)
    expect(result.valid).toBe(false)
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'non_contiguous_group', 'non_consecutive_ranking', 'duplicate_bonus', 'required_with_scope',
    ]))
  })

  it('requires exactly one parent, one correct choice, and complete effective part metadata', () => {
    const workbook = validWorkbook()
    workbook.Questions!.rows[3].values['Correct Choice?'] = ''
    workbook.Questions!.rows[10].values.Category = ''
    workbook.Questions!.rows[10].values.Difficulty = ''
    const result = validateQuestionLibraryWorkbook(workbook)
    expect(result.valid).toBe(false)
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['correct_choice_count', 'required']))
  })

  it('validates Locale against inherited child Scope', () => {
    const workbook = validWorkbook()
    workbook.Questions!.rows[10].values.Locale = 'Australia'
    const result = validateQuestionLibraryWorkbook(workbook)
    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 12, column: 'Locale', code: 'unexpected_locale' }),
    ]))
  })
})
