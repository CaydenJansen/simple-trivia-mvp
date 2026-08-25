import type { AudienceScope, QuestionMechanic, QuestionStatus } from '@/lib/supabase/database.types'

import { answerVariants } from './answer-variants'
import { isStarterTagOrAlias, normalizeTagPhrase } from './question-library-tags'

export const QUESTION_LIBRARY_IMPORT_VERSION = 3
export const IMPORT_SHEET_NAMES = ['Questions', 'Tiebreakers'] as const
export type ImportSheetName = (typeof IMPORT_SHEET_NAMES)[number]
export type ImportAudienceFit = 'broad' | 'kids' | 'young_adults' | 'older_adults'
export type ImportTagMode = 'add' | 'inherit' | 'replace'

export type WorkbookRow = { rowNumber: number; values: Record<string, unknown> }
export type WorkbookSheet = { headers: string[]; rows: WorkbookRow[] }
export type QuestionLibraryWorkbook = Partial<Record<ImportSheetName, WorkbookSheet>>
export type ImportIssue = {
  severity: 'error' | 'warning'
  sheet: ImportSheetName
  row: number | null
  column: string | null
  code: string
  message: string
}

export type ImportMetadata = {
  primaryCategory: string | null
  editorialDifficulty: number | null
  tagPhrases: string[]
  audienceFit: ImportAudienceFit | null
  adultContent: boolean | null
  audienceScope: AudienceScope | null
  audienceLocale: string | null
}

export type ImportQuestionPart = ImportMetadata & {
  position: number
  label: string
  prompt: string
  correctAnswer: string
  acceptedAnswers: string[]
  tagMode: 'add'
}

export type ImportBonus = ImportMetadata & {
  prompt: string
  correctAnswer: string
  acceptedAnswers: string[]
  points: number
  tagMode: 'inherit' | 'replace'
  notes: string | null
}

export type ImportQuestion = ImportMetadata & {
  importKey: string
  prompt: string
  mechanic: QuestionMechanic
  correctAnswer: string | string[]
  acceptedAnswers: string[] | string[][]
  options: Array<{ key: string; label: string }> | Array<{ label: string; clue: string }> | string[] | null
  notes: string | null
  status: Extract<QuestionStatus, 'needs_review'>
  promptSignature: string
  parts: ImportQuestionPart[]
  bonus: ImportBonus | null
}

export type ImportTiebreaker = ImportMetadata & {
  importKey: string
  prompt: string
  correctValue: number
  answerUnit: string | null
  notes: string | null
  status: Extract<QuestionStatus, 'needs_review'>
}

export type QuestionLibraryImportPlan = {
  version: typeof QUESTION_LIBRARY_IMPORT_VERSION
  questions: ImportQuestion[]
  tiebreakers: ImportTiebreaker[]
}

export type ImportValidationResult = { valid: boolean; issues: ImportIssue[]; plan: QuestionLibraryImportPlan | null }

const QUESTION_COLUMNS = [
  'Question ID', 'Row Type', 'Label', 'Prompt / Clue', 'Answer', 'Accepted Answers',
  'Correct Choice?', 'Category', 'Difficulty', 'Tags', 'Audience Fit', 'Adult Content?',
  'Scope', 'Locale', 'Notes',
] as const
const TIEBREAKER_COLUMNS = [
  'Tiebreaker ID', 'Prompt', 'Correct Numeric Answer', 'Unit', 'Category', 'Difficulty',
  'Audience Fit', 'Adult Content?', 'Scope', 'Locale', 'Notes',
] as const

const REQUIRED_COLUMNS: Record<ImportSheetName, readonly string[]> = {
  Questions: ['Question ID', 'Row Type', 'Label', 'Prompt / Clue', 'Answer', 'Category', 'Difficulty'],
  Tiebreakers: ['Tiebreaker ID', 'Prompt', 'Correct Numeric Answer', 'Category', 'Difficulty'],
}
const COLUMN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'Correct Choice?': ['Correct Choice?', 'Correct?'],
  'Adult Content?': ['Adult Content?', 'Adult?'],
}
const CATEGORY_SLUGS: Readonly<Record<string, string>> = {
  geography: 'geography', history: 'history', 'science nature': 'science-nature', sport: 'sport',
  music: 'music', 'film television': 'film-television', 'arts literature': 'arts-literature',
  'food drink': 'food-drink', 'society culture': 'society-culture', 'language words': 'language-words',
  'technology inventions': 'technology-inventions', 'games leisure': 'games-leisure',
  'business brands': 'business-brands', 'politics government': 'politics-government',
}
const ROW_TYPES = new Set(['question', 'choice', 'answer', 'part', 'ranking', 'bonus'])
const STRUCTURAL_ROW_TYPES = new Set(['choice', 'answer', 'part', 'ranking'])
const AUDIENCE_FITS: Readonly<Record<string, ImportAudienceFit>> = {
  broad: 'broad', kids: 'kids', 'young adults': 'young_adults', 'older adults': 'older_adults',
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function normalizedComparable(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function promptSignature(value: string): string {
  return normalizedComparable(value)
}

function deduplicatedList(value: unknown): string[] {
  const values: string[] = []
  const seen = new Set<string>()
  for (const item of text(value).split(';').map(entry => entry.trim()).filter(Boolean)) {
    const normalized = normalizedComparable(item)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    values.push(item)
  }
  return values
}

function acceptedAnswers(value: unknown, correctAnswer: string) {
  const correct = normalizedComparable(correctAnswer)
  return deduplicatedList(value).filter(alias => normalizedComparable(alias) !== correct)
}

function importedAnswer(value: unknown, aliasValue: unknown) {
  const parsed = answerVariants(text(value))
  const aliases = [...parsed.accepted, ...acceptedAnswers(aliasValue, parsed.primary)]
  const seen = new Set<string>()
  return {
    correct: parsed.primary,
    accepted: aliases.filter(alias => {
      const key = normalizedComparable(alias)
      if (!key || key === normalizedComparable(parsed.primary) || seen.has(key)) return false
      seen.add(key)
      return true
    }),
  }
}

function aliasesForColumn(column: string) {
  return COLUMN_ALIASES[column] ?? [column]
}

function valueAt(row: WorkbookRow, column: string) {
  for (const candidate of aliasesForColumn(column)) {
    if (Object.prototype.hasOwnProperty.call(row.values, candidate)) return row.values[candidate]
  }
  return undefined
}

function hasColumn(sheet: WorkbookSheet, column: string) {
  return aliasesForColumn(column).some(candidate => sheet.headers.includes(candidate))
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  const normalized = normalizedComparable(text(value))
  if (['yes', 'true', '1'].includes(normalized)) return true
  if (['no', 'false', '0'].includes(normalized)) return false
  return null
}

function parseInteger(value: unknown): number | null {
  const raw = text(value)
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) ? parsed : null
}

function parseNumber(value: unknown): number | null {
  const raw = text(value)
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function importKeyIsValid(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

function categorySlug(value: unknown): string | null {
  const raw = text(value)
  return raw ? CATEGORY_SLUGS[normalizedComparable(raw)] ?? null : null
}

type AddIssue = (
  severity: ImportIssue['severity'], sheet: ImportSheetName, row: number | null,
  column: string | null, code: string, message: string,
) => void

function parseMetadata(row: WorkbookRow, sheet: ImportSheetName, addIssue: AddIssue, inherit: boolean): ImportMetadata {
  const rawCategory = text(valueAt(row, 'Category'))
  const primaryCategory = categorySlug(rawCategory)
  if (rawCategory && !primaryCategory) addIssue('error', sheet, row.rowNumber, 'Category', 'invalid_category', `“${rawCategory}” is not an approved category.`)

  const rawDifficulty = text(valueAt(row, 'Difficulty'))
  const editorialDifficulty = parseInteger(rawDifficulty)
  if (rawDifficulty && (editorialDifficulty === null || editorialDifficulty < 1 || editorialDifficulty > 5)) {
    addIssue('error', sheet, row.rowNumber, 'Difficulty', 'invalid_difficulty', 'Difficulty must be a whole number from 1 to 5.')
  }

  const tagPhrases = deduplicatedList(valueAt(row, 'Tags'))
  for (const phrase of tagPhrases) {
    if (!isStarterTagOrAlias(phrase)) {
      addIssue('warning', sheet, row.rowNumber, 'Tags', 'proposed_tag', `“${phrase}” will be preserved for bulk tag review if the database does not recognize it.`)
    }
  }

  const rawAudienceFit = text(valueAt(row, 'Audience Fit'))
  const audienceFit = rawAudienceFit ? AUDIENCE_FITS[normalizedComparable(rawAudienceFit)] ?? null : inherit ? null : 'broad'
  if (rawAudienceFit && !audienceFit) addIssue('error', sheet, row.rowNumber, 'Audience Fit', 'invalid_audience_fit', 'Use Broad, Kids, Young Adults or Older Adults.')

  const rawAdultContent = text(valueAt(row, 'Adult Content?'))
  const adultContent = rawAdultContent ? parseBoolean(rawAdultContent) : inherit ? null : false
  if (rawAdultContent && adultContent === null) addIssue('error', sheet, row.rowNumber, 'Adult Content?', 'invalid_boolean', 'Use Yes or No.')

  const rawScope = text(valueAt(row, 'Scope'))
  const normalizedScope = normalizedComparable(rawScope)
  const audienceScope: AudienceScope | null = !rawScope
    ? inherit ? null : 'global'
    : normalizedScope === 'global' ? 'global' : normalizedScope === 'country specific' ? 'country_specific' : null
  if (rawScope && !audienceScope) addIssue('error', sheet, row.rowNumber, 'Scope', 'invalid_scope', 'Use Global or Country-specific.')

  const audienceLocale = text(valueAt(row, 'Locale')) || null
  if (audienceScope === 'country_specific' && !audienceLocale) addIssue('error', sheet, row.rowNumber, 'Locale', 'required_with_scope', 'Locale is required when Scope is Country-specific.')
  if (audienceScope === 'global' && audienceLocale) addIssue('error', sheet, row.rowNumber, 'Locale', 'unexpected_locale', 'Locale must be blank when Scope is Global.')

  return { primaryCategory, editorialDifficulty, tagPhrases, audienceFit, adultContent, audienceScope, audienceLocale }
}

function effectiveMetadata(parent: ImportMetadata, child: ImportMetadata): ImportMetadata {
  const audienceScope = child.audienceScope ?? parent.audienceScope ?? 'global'
  return {
    primaryCategory: child.primaryCategory ?? parent.primaryCategory,
    editorialDifficulty: child.editorialDifficulty ?? parent.editorialDifficulty,
    tagPhrases: child.tagPhrases,
    audienceFit: child.audienceFit ?? parent.audienceFit ?? 'broad',
    adultContent: child.adultContent ?? parent.adultContent ?? false,
    audienceScope,
    audienceLocale: child.audienceLocale ?? (audienceScope === 'country_specific' ? parent.audienceLocale : null),
  }
}

function requireEffectiveClassification(metadata: ImportMetadata, sheet: ImportSheetName, row: number, addIssue: AddIssue) {
  if (!metadata.primaryCategory) addIssue('error', sheet, row, 'Category', 'required', 'An effective Category is required after inheritance.')
  if (!metadata.editorialDifficulty) addIssue('error', sheet, row, 'Difficulty', 'required', 'An effective Difficulty is required after inheritance.')
  if (metadata.audienceScope === 'country_specific' && !metadata.audienceLocale) {
    addIssue('error', sheet, row, 'Locale', 'required_with_scope', 'An effective Locale is required for Country-specific content.')
  }
  if (metadata.audienceScope === 'global' && metadata.audienceLocale) {
    addIssue('error', sheet, row, 'Locale', 'unexpected_locale', 'Locale must be blank when the effective Scope is Global.')
  }
}

export function validateQuestionLibraryWorkbook(workbook: QuestionLibraryWorkbook): ImportValidationResult {
  const issues: ImportIssue[] = []
  const addIssue: AddIssue = (severity, sheet, row, column, code, message) => issues.push({ severity, sheet, row, column, code, message })

  for (const sheetName of IMPORT_SHEET_NAMES) {
    const sheet = workbook[sheetName]
    if (!sheet) {
      addIssue('error', sheetName, null, null, 'missing_sheet', `Missing required “${sheetName}” sheet.`)
      continue
    }
    for (const column of REQUIRED_COLUMNS[sheetName]) {
      if (!hasColumn(sheet, column)) addIssue('error', sheetName, 1, column, 'missing_header', `Missing required “${column}” column.`)
    }
  }
  if (issues.some(issue => issue.severity === 'error')) return { valid: false, issues, plan: null }

  const groups = new Map<string, WorkbookRow[]>()
  const order: string[] = []
  const closed = new Set<string>()
  let previous: string | null = null
  for (const row of workbook.Questions!.rows) {
    const key = text(valueAt(row, 'Question ID'))
    if (!key) {
      addIssue('error', 'Questions', row.rowNumber, 'Question ID', 'required', 'Question ID is required on every row.')
      continue
    }
    if (!importKeyIsValid(key)) addIssue('error', 'Questions', row.rowNumber, 'Question ID', 'invalid_import_key', 'Use letters, numbers, dots, underscores or hyphens, beginning with a letter or number.')
    if (previous !== key) {
      if (previous) closed.add(previous)
      if (closed.has(key)) addIssue('error', 'Questions', row.rowNumber, 'Question ID', 'non_contiguous_group', `Rows for “${key}” must remain grouped together.`)
      previous = key
    }
    if (!groups.has(key)) order.push(key)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  const questions: ImportQuestion[] = []
  const promptRows = new Map<string, number>()
  for (const importKey of order) {
    const rows = groups.get(importKey) ?? []
    const typed = rows.map(row => ({ row, kind: normalizedComparable(text(valueAt(row, 'Row Type'))) }))
    typed.forEach(({ row, kind }) => {
      if (!ROW_TYPES.has(kind)) addIssue('error', 'Questions', row.rowNumber, 'Row Type', 'invalid_row_type', 'Use Question, Choice, Answer, Part, Ranking or Bonus.')
    })
    const parents = typed.filter(item => item.kind === 'question')
    if (parents.length !== 1) {
      addIssue('error', 'Questions', rows[0]?.rowNumber ?? null, 'Row Type', 'question_parent_count', `Question ID “${importKey}” must have exactly one Question parent row.`)
      continue
    }

    const parentRow = parents[0].row
    const prompt = text(valueAt(parentRow, 'Prompt / Clue'))
    if (!prompt) addIssue('error', 'Questions', parentRow.rowNumber, 'Prompt / Clue', 'required', 'Question prompt is required.')
    const signature = promptSignature(prompt)
    if (signature && promptRows.has(signature)) addIssue('warning', 'Questions', parentRow.rowNumber, 'Prompt / Clue', 'duplicate_prompt', `This prompt also appears on row ${promptRows.get(signature)}.`)
    else if (signature) promptRows.set(signature, parentRow.rowNumber)

    const parentMetadata = parseMetadata(parentRow, 'Questions', addIssue, false)
    const structuralKinds = [...new Set(typed.map(item => item.kind).filter(kind => STRUCTURAL_ROW_TYPES.has(kind)))]
    if (structuralKinds.length > 1) {
      addIssue('error', 'Questions', parentRow.rowNumber, 'Row Type', 'contradictory_structure', `Question “${importKey}” mixes incompatible ${structuralKinds.join(' and ')} rows.`)
      continue
    }
    const structuralKind = structuralKinds[0] ?? null
    const mechanic: QuestionMechanic = structuralKind === 'choice' ? 'multiple-choice'
      : structuralKind === 'answer' ? 'multi-answer'
        : structuralKind === 'part' ? 'multi-part'
          : structuralKind === 'ranking' ? 'ranking' : 'single-answer'
    const structuralRows = typed.filter(item => item.kind === structuralKind).map(item => item.row)
    let correctAnswer: string | string[] = ''
    let aliases: string[] | string[][] = []
    let options: ImportQuestion['options'] = null
    const parts: ImportQuestionPart[] = []

    if (mechanic === 'single-answer') {
      const answer = importedAnswer(valueAt(parentRow, 'Answer'), valueAt(parentRow, 'Accepted Answers'))
      correctAnswer = answer.correct
      if (!correctAnswer) addIssue('error', 'Questions', parentRow.rowNumber, 'Answer', 'required', 'Single Answer questions require an Answer.')
      aliases = answer.accepted
      requireEffectiveClassification(parentMetadata, 'Questions', parentRow.rowNumber, addIssue)
    } else if (mechanic === 'multiple-choice') {
      if (structuralRows.length < 2) addIssue('error', 'Questions', parentRow.rowNumber, 'Row Type', 'too_few_choices', 'Multiple Choice requires at least two Choice rows.')
      const usedLabels = new Set<string>()
      const choices: Array<{ key: string; label: string }> = []
      const correctChoices: string[] = []
      structuralRows.forEach((row, index) => {
        const key = text(valueAt(row, 'Label')) || String.fromCharCode(65 + index)
        const normalizedKey = normalizedComparable(key)
        const label = text(valueAt(row, 'Prompt / Clue')) || text(valueAt(row, 'Answer'))
        if (!label) addIssue('error', 'Questions', row.rowNumber, 'Prompt / Clue', 'required', 'Choice text is required.')
        if (usedLabels.has(normalizedKey)) addIssue('error', 'Questions', row.rowNumber, 'Label', 'duplicate_label', `Choice label “${key}” is duplicated.`)
        usedLabels.add(normalizedKey)
        choices.push({ key, label })
        const rawCorrect = text(valueAt(row, 'Correct Choice?'))
        const isCorrect = rawCorrect ? parseBoolean(rawCorrect) : false
        if (rawCorrect && isCorrect === null) addIssue('error', 'Questions', row.rowNumber, 'Correct Choice?', 'invalid_boolean', 'Use Yes for the correct choice and leave the others blank or use No.')
        if (isCorrect) correctChoices.push(key)
      })
      if (correctChoices.length !== 1) addIssue('error', 'Questions', parentRow.rowNumber, 'Correct Choice?', 'correct_choice_count', 'Multiple Choice requires exactly one correct Choice.')
      correctAnswer = correctChoices[0] ?? ''
      options = choices
      requireEffectiveClassification(parentMetadata, 'Questions', parentRow.rowNumber, addIssue)
    } else if (mechanic === 'multi-answer') {
      const answerValues: string[] = []
      const aliasValues: string[][] = []
      const seenAnswers = new Set<string>()
      structuralRows.forEach(row => {
        const parsedAnswer = importedAnswer(valueAt(row, 'Answer'), valueAt(row, 'Accepted Answers'))
        const answer = parsedAnswer.correct
        if (!answer) addIssue('error', 'Questions', row.rowNumber, 'Answer', 'required', 'Each Answer row requires an answer.')
        const normalized = normalizedComparable(answer)
        if (normalized && seenAnswers.has(normalized)) addIssue('error', 'Questions', row.rowNumber, 'Answer', 'duplicate_answer', `Answer “${answer}” is duplicated.`)
        seenAnswers.add(normalized)
        answerValues.push(answer)
        aliasValues.push(parsedAnswer.accepted)
      })
      if (answerValues.length < 2) addIssue('error', 'Questions', parentRow.rowNumber, 'Row Type', 'too_few_answers', 'Multi-Answer requires at least two distinct Answer rows.')
      correctAnswer = answerValues
      aliases = aliasValues
      requireEffectiveClassification(parentMetadata, 'Questions', parentRow.rowNumber, addIssue)
    } else if (mechanic === 'multi-part') {
      const usedLabels = new Set<string>()
      structuralRows.forEach((row, index) => {
        const label = text(valueAt(row, 'Label')) || String.fromCharCode(65 + index)
        const normalizedLabel = normalizedComparable(label)
        const partPrompt = text(valueAt(row, 'Prompt / Clue'))
        const parsedAnswer = importedAnswer(valueAt(row, 'Answer'), valueAt(row, 'Accepted Answers'))
        const answer = parsedAnswer.correct
        if (usedLabels.has(normalizedLabel)) addIssue('error', 'Questions', row.rowNumber, 'Label', 'duplicate_label', `Part label “${label}” is duplicated.`)
        usedLabels.add(normalizedLabel)
        if (!partPrompt) addIssue('error', 'Questions', row.rowNumber, 'Prompt / Clue', 'required', 'Each Part requires a clue.')
        if (!answer) addIssue('error', 'Questions', row.rowNumber, 'Answer', 'required', 'Each Part requires an answer.')
        const metadata = parseMetadata(row, 'Questions', addIssue, true)
        requireEffectiveClassification(effectiveMetadata(parentMetadata, metadata), 'Questions', row.rowNumber, addIssue)
        parts.push({ ...metadata, position: index + 1, label, prompt: partPrompt, correctAnswer: answer, acceptedAnswers: parsedAnswer.accepted, tagMode: 'add' })
      })
      if (parts.length < 2) addIssue('error', 'Questions', parentRow.rowNumber, 'Row Type', 'too_few_parts', 'Multi-Part requires at least two Part rows.')
      correctAnswer = parts.map(part => part.correctAnswer)
      aliases = parts.map(part => part.acceptedAnswers)
      options = parts.map(part => ({ label: part.label, clue: part.prompt }))
    } else {
      const ranked = structuralRows.map(row => ({ row, position: parseInteger(valueAt(row, 'Label')), label: text(valueAt(row, 'Prompt / Clue')) || text(valueAt(row, 'Answer')) }))
      ranked.forEach(item => {
        if (!item.position || item.position < 1) addIssue('error', 'Questions', item.row.rowNumber, 'Label', 'invalid_ranking_position', 'Ranking labels must be positive whole-number positions.')
        if (!item.label) addIssue('error', 'Questions', item.row.rowNumber, 'Prompt / Clue', 'required', 'Each Ranking row requires an item.')
      })
      const positions = ranked.map(item => item.position).filter((value): value is number => value !== null).sort((a, b) => a - b)
      if (positions.length < 2) addIssue('error', 'Questions', parentRow.rowNumber, 'Row Type', 'too_few_ranking_items', 'Ranking requires at least two items.')
      if (positions.some((position, index) => position !== index + 1)) addIssue('error', 'Questions', parentRow.rowNumber, 'Label', 'non_consecutive_ranking', 'Ranking positions must be unique and consecutive from 1.')
      const ordered = [...ranked].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      correctAnswer = ordered.map(item => item.label)
      options = ordered.map(item => item.label)
      requireEffectiveClassification(parentMetadata, 'Questions', parentRow.rowNumber, addIssue)
    }

    const bonusRows = typed.filter(item => item.kind === 'bonus').map(item => item.row)
    if (bonusRows.length > 1) addIssue('error', 'Questions', bonusRows[1].rowNumber, 'Row Type', 'duplicate_bonus', 'Only one Bonus is allowed per question.')
    let bonus: ImportBonus | null = null
    if (bonusRows[0]) {
      const row = bonusRows[0]
      const bonusPrompt = text(valueAt(row, 'Prompt / Clue'))
      const parsedAnswer = importedAnswer(valueAt(row, 'Answer'), valueAt(row, 'Accepted Answers'))
      const answer = parsedAnswer.correct
      if (!bonusPrompt) addIssue('error', 'Questions', row.rowNumber, 'Prompt / Clue', 'required', 'Bonus prompt is required.')
      if (!answer) addIssue('error', 'Questions', row.rowNumber, 'Answer', 'required', 'Bonus answer is required.')
      const metadata = parseMetadata(row, 'Questions', addIssue, true)
      requireEffectiveClassification(effectiveMetadata(parentMetadata, metadata), 'Questions', row.rowNumber, addIssue)
      bonus = { ...metadata, prompt: bonusPrompt, correctAnswer: answer, acceptedAnswers: parsedAnswer.accepted, points: 1, tagMode: metadata.tagPhrases.length ? 'replace' : 'inherit', notes: text(valueAt(row, 'Notes')) || null }
    }

    questions.push({ ...parentMetadata, importKey, prompt, mechanic, correctAnswer, acceptedAnswers: aliases, options, notes: text(valueAt(parentRow, 'Notes')) || null, status: 'needs_review', promptSignature: signature, parts, bonus })
  }

  const tiebreakers: ImportTiebreaker[] = []
  const tiebreakerKeys = new Set<string>()
  for (const row of workbook.Tiebreakers!.rows) {
    const importKey = text(valueAt(row, 'Tiebreaker ID'))
    const prompt = text(valueAt(row, 'Prompt'))
    const correctValue = parseNumber(valueAt(row, 'Correct Numeric Answer'))
    if (!importKey) addIssue('error', 'Tiebreakers', row.rowNumber, 'Tiebreaker ID', 'required', 'Tiebreaker ID is required.')
    else if (!importKeyIsValid(importKey)) addIssue('error', 'Tiebreakers', row.rowNumber, 'Tiebreaker ID', 'invalid_import_key', 'Use letters, numbers, dots, underscores or hyphens.')
    else if (tiebreakerKeys.has(importKey)) addIssue('error', 'Tiebreakers', row.rowNumber, 'Tiebreaker ID', 'duplicate_import_key', `Tiebreaker ID “${importKey}” is duplicated.`)
    tiebreakerKeys.add(importKey)
    if (!prompt) addIssue('error', 'Tiebreakers', row.rowNumber, 'Prompt', 'required', 'Tiebreaker prompt is required.')
    if (correctValue === null) addIssue('error', 'Tiebreakers', row.rowNumber, 'Correct Numeric Answer', 'invalid_number', 'Correct Numeric Answer must be a number.')
    const metadata = parseMetadata(row, 'Tiebreakers', addIssue, false)
    requireEffectiveClassification(metadata, 'Tiebreakers', row.rowNumber, addIssue)
    if (importKey && prompt && correctValue !== null) {
      tiebreakers.push({ ...metadata, importKey, prompt, correctValue, answerUnit: text(valueAt(row, 'Unit')) || null, notes: text(valueAt(row, 'Notes')) || null, status: 'needs_review' })
    }
  }

  const valid = !issues.some(issue => issue.severity === 'error')
  return { valid, issues, plan: valid ? { version: QUESTION_LIBRARY_IMPORT_VERSION, questions, tiebreakers } : null }
}

export function importPlanCounts(plan: QuestionLibraryImportPlan) {
  const phrases = plan.questions.flatMap(question => [
    ...question.tagPhrases,
    ...question.parts.flatMap(part => part.tagPhrases),
    ...(question.bonus?.tagPhrases ?? []),
  ]).concat(plan.tiebreakers.flatMap(tiebreaker => tiebreaker.tagPhrases))
  return {
    questions: plan.questions.length,
    questionParts: plan.questions.reduce((total, question) => total + question.parts.length, 0),
    bonuses: plan.questions.filter(question => question.bonus).length,
    tiebreakers: plan.tiebreakers.length,
    tagPhrases: phrases.length,
    proposedTagPhrases: new Set(phrases.filter(phrase => !isStarterTagOrAlias(phrase)).map(normalizeTagPhrase)).size,
  }
}

export const QUESTION_LIBRARY_COLUMNS = { Questions: QUESTION_COLUMNS, Tiebreakers: TIEBREAKER_COLUMNS } as const
