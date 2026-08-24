import type { FactualStability, QuestionMechanic, QuestionStatus } from '@/lib/supabase/database.types'

export const QUESTION_LIBRARY_IMPORT_VERSION = 1

export const IMPORT_SHEET_NAMES = [
  'Questions',
  'Question Items',
  'Bonuses',
  'Tiebreakers',
  'Tags',
] as const

export type ImportSheetName = (typeof IMPORT_SHEET_NAMES)[number]

export type WorkbookRow = {
  rowNumber: number
  values: Record<string, unknown>
}

export type WorkbookSheet = {
  headers: string[]
  rows: WorkbookRow[]
}

export type QuestionLibraryWorkbook = Partial<Record<ImportSheetName, WorkbookSheet>>

export type ImportIssue = {
  severity: 'error' | 'warning'
  sheet: ImportSheetName
  row: number | null
  column: string | null
  code: string
  message: string
}

export type ImportSourceReference = {
  name: string | null
  url: string | null
  checkedDate: string | null
}

export type ImportMedia = {
  url: string
  alt: string | null
}

export type ImportQuestionPart = {
  position: number
  label: string
  prompt: string
  correctAnswer: string
  acceptedAnswers: string[]
  primaryCategory: string
  secondaryCategories: string[]
  tags: string[]
  promptPattern: string
  answerType: string
  editorialDifficulty: number
  stability: FactualStability
  media: ImportMedia | null
}

export type ImportBonus = {
  prompt: string
  correctAnswer: string
  acceptedAnswers: string[]
  points: number
  primaryCategory: string
  secondaryCategories: string[]
  tags: string[]
  promptPattern: string
  answerType: string
  editorialDifficulty: number
  stability: FactualStability
  media: ImportMedia | null
  notes: string | null
  source: ImportSourceReference
}

export type ImportQuestion = {
  importKey: string
  prompt: string
  mechanic: QuestionMechanic
  correctAnswer: string | string[]
  acceptedAnswers: string[] | string[][]
  options: Array<{ key: string; label: string }> | Array<{ label: string; clue: string }> | string[] | null
  primaryCategory: string | null
  secondaryCategories: string[]
  tags: string[]
  promptPattern: string
  answerType: string | null
  editorialDifficulty: number | null
  stability: FactualStability
  asOfDate: string | null
  reviewDueAt: string | null
  validFrom: string | null
  expiresAt: string | null
  media: ImportMedia | null
  notes: string | null
  status: Extract<QuestionStatus, 'draft' | 'needs_review'>
  source: ImportSourceReference
  promptSignature: string
  parts: ImportQuestionPart[]
  bonus: ImportBonus | null
}

export type ImportTiebreaker = {
  importKey: string
  prompt: string
  correctValue: number
  answerUnit: string | null
  notes: string | null
  status: Extract<QuestionStatus, 'draft' | 'needs_review'>
  source: ImportSourceReference
}

export type ImportTag = {
  slug: string
  name: string
  parentTag: string | null
  specificity: number
  diversityWeight: number
  aliases: string[]
  active: boolean
}

export type QuestionLibraryImportPlan = {
  version: typeof QUESTION_LIBRARY_IMPORT_VERSION
  questions: ImportQuestion[]
  tiebreakers: ImportTiebreaker[]
  tags: ImportTag[]
}

export type ImportValidationResult = {
  valid: boolean
  issues: ImportIssue[]
  plan: QuestionLibraryImportPlan | null
}

const REQUIRED_HEADERS: Record<ImportSheetName, readonly string[]> = {
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

const CATEGORY_SLUGS = new Set([
  'geography', 'history', 'science-nature', 'sport', 'music', 'film-television',
  'arts-literature', 'food-drink', 'society-culture', 'language-words',
  'technology-inventions', 'games-leisure', 'business-brands', 'politics-government',
])

const MECHANICS = new Set<QuestionMechanic>([
  'single-answer', 'multiple-choice', 'multi-answer', 'multi-part', 'ranking',
])

const ITEM_KINDS = new Set(['choice', 'answer', 'part', 'ranking_item'])
const STABILITIES = new Set<FactualStability>(['stable', 'review_periodically', 'volatile'])
const IMPORTABLE_STATUSES = new Set(['draft', 'needs_review'])
const PROMPT_PATTERNS = new Set([
  'name-term-identification', 'person-identification', 'place-identification', 'quantity',
  'year-date', 'definition', 'which-of-the-following', 'identify-from-clue',
  'identify-from-image', 'origin-etymology', 'complete-phrase-title', 'list-answers',
  'ranking-ordering', 'match-clue-answer',
])
const ANSWER_TYPES = new Set([
  'person', 'place', 'country', 'city', 'number', 'year-date', 'term', 'organisation',
  'brand', 'animal-species', 'title', 'film-tv-title', 'song', 'artist', 'object', 'event',
])

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function pipeList(value: unknown): string[] {
  return [...new Set(text(value).split('|').map(item => item.trim()).filter(Boolean))]
}

function normalizedComparable(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function promptSignature(value: string): string {
  return normalizedComparable(value)
}

function slugIsValid(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

function importKeyIsValid(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  const normalized = text(value).toLocaleLowerCase()
  if (['true', 'yes', '1'].includes(normalized)) return true
  if (['false', 'no', '0'].includes(normalized)) return false
  return null
}

function parseInteger(value: unknown): number | null {
  const parsed = Number(text(value))
  return Number.isInteger(parsed) ? parsed : null
}

function parseNumber(value: unknown): number | null {
  const parsed = Number(text(value))
  return Number.isFinite(parsed) ? parsed : null
}

function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || text(value) === '') return null
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10)

  const raw = text(value)
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) {
    const parsed = new Date(`${raw}T00:00:00Z`)
    return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== raw ? null : raw
  }

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw)
  if (slash) {
    const month = slash[1].padStart(2, '0')
    const day = slash[2].padStart(2, '0')
    return isoDate(`${slash[3]}-${month}-${day}`)
  }

  return null
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function valueAt(row: WorkbookRow, column: string) {
  return row.values[column]
}

export function validateQuestionLibraryWorkbook(workbook: QuestionLibraryWorkbook): ImportValidationResult {
  const issues: ImportIssue[] = []
  const addIssue = (
    severity: ImportIssue['severity'],
    sheet: ImportSheetName,
    row: number | null,
    column: string | null,
    code: string,
    message: string,
  ) => issues.push({ severity, sheet, row, column, code, message })

  for (const sheetName of IMPORT_SHEET_NAMES) {
    const sheet = workbook[sheetName]
    if (!sheet) {
      addIssue('error', sheetName, null, null, 'missing_sheet', `Missing required “${sheetName}” sheet.`)
      continue
    }
    const headers = new Set(sheet.headers)
    for (const header of REQUIRED_HEADERS[sheetName]) {
      if (!headers.has(header)) {
        addIssue('error', sheetName, 1, header, 'missing_header', `Missing required “${header}” column.`)
      }
    }
  }

  if (issues.some(issue => issue.severity === 'error')) {
    return { valid: false, issues, plan: null }
  }

  const questionRows = workbook.Questions!.rows
  const itemRows = workbook['Question Items']!.rows
  const bonusRows = workbook.Bonuses!.rows
  const tiebreakerRows = workbook.Tiebreakers!.rows
  const tagRows = workbook.Tags!.rows

  const tags: ImportTag[] = []
  const tagRowBySlug = new Map<string, WorkbookRow>()
  const aliasOwners = new Map<string, string>()

  for (const row of tagRows) {
    const slug = text(valueAt(row, 'slug'))
    const name = text(valueAt(row, 'name'))
    const parentTag = text(valueAt(row, 'parent_tag')) || null
    const specificity = parseInteger(valueAt(row, 'specificity'))
    const diversityWeight = parseNumber(valueAt(row, 'diversity_weight'))
    const aliases = pipeList(valueAt(row, 'aliases'))
    const active = parseBoolean(valueAt(row, 'active'))

    if (!slug) addIssue('error', 'Tags', row.rowNumber, 'slug', 'required', 'Tag slug is required.')
    else if (!slugIsValid(slug)) addIssue('error', 'Tags', row.rowNumber, 'slug', 'invalid_slug', 'Use lowercase letters, numbers and single hyphens only.')
    else if (tagRowBySlug.has(slug)) addIssue('error', 'Tags', row.rowNumber, 'slug', 'duplicate_tag', `Tag “${slug}” appears more than once.`)
    else tagRowBySlug.set(slug, row)

    if (!name) addIssue('error', 'Tags', row.rowNumber, 'name', 'required', 'Tag name is required.')
    if (parentTag === slug) addIssue('error', 'Tags', row.rowNumber, 'parent_tag', 'self_parent', 'A tag cannot be its own parent.')
    if (parentTag && !slugIsValid(parentTag)) addIssue('error', 'Tags', row.rowNumber, 'parent_tag', 'invalid_slug', 'Parent tag must be a canonical slug.')
    if (specificity === null || specificity < 1 || specificity > 4) {
      addIssue('error', 'Tags', row.rowNumber, 'specificity', 'invalid_specificity', 'Specificity must be a whole number from 1 to 4.')
    }
    if (diversityWeight === null || diversityWeight < 0) {
      addIssue('error', 'Tags', row.rowNumber, 'diversity_weight', 'invalid_weight', 'Diversity weight must be zero or greater.')
    }
    if (active === null) addIssue('error', 'Tags', row.rowNumber, 'active', 'invalid_boolean', 'Use TRUE or FALSE.')

    for (const alias of aliases) {
      const normalized = normalizedComparable(alias)
      const owner = aliasOwners.get(normalized)
      if (owner && owner !== slug) {
        addIssue('error', 'Tags', row.rowNumber, 'aliases', 'duplicate_alias', `Alias “${alias}” is already assigned to “${owner}”.`)
      } else {
        aliasOwners.set(normalized, slug)
      }
    }

    if (slug && name && specificity !== null && diversityWeight !== null && active !== null) {
      tags.push({ slug, name, parentTag, specificity, diversityWeight, aliases, active })
    }
  }

  for (const tag of tags) {
    if (tag.parentTag && !tagRowBySlug.has(tag.parentTag)) {
      addIssue('warning', 'Tags', tagRowBySlug.get(tag.slug)?.rowNumber ?? null, 'parent_tag', 'external_parent', `Parent “${tag.parentTag}” must already exist in the database.`)
    }
  }

  const itemRowsByQuestion = new Map<string, WorkbookRow[]>()
  for (const row of itemRows) {
    const key = text(valueAt(row, 'question_import_key'))
    if (!key) {
      addIssue('error', 'Question Items', row.rowNumber, 'question_import_key', 'required', 'Question import key is required.')
      continue
    }
    const rows = itemRowsByQuestion.get(key) ?? []
    rows.push(row)
    itemRowsByQuestion.set(key, rows)
  }

  const bonusRowByQuestion = new Map<string, WorkbookRow>()
  for (const row of bonusRows) {
    const key = text(valueAt(row, 'question_import_key'))
    if (!key) {
      addIssue('error', 'Bonuses', row.rowNumber, 'question_import_key', 'required', 'Question import key is required.')
      continue
    }
    if (bonusRowByQuestion.has(key)) {
      addIssue('error', 'Bonuses', row.rowNumber, 'question_import_key', 'duplicate_bonus', `Question “${key}” has more than one bonus.`)
    } else {
      bonusRowByQuestion.set(key, row)
    }
  }

  const questionKeyRows = new Map<string, WorkbookRow>()
  const promptRows = new Map<string, WorkbookRow>()
  const referencedTags = new Map<string, { sheet: ImportSheetName; row: number }>()
  const questions: ImportQuestion[] = []

  const validateCategory = (value: string, sheet: ImportSheetName, row: number, column: string, required: boolean) => {
    if (!value) {
      if (required) addIssue('error', sheet, row, column, 'required', 'Primary category is required.')
      return
    }
    if (!CATEGORY_SLUGS.has(value)) addIssue('error', sheet, row, column, 'invalid_category', `“${value}” is not an approved category.`)
  }

  const validateCategories = (primary: string | null, secondary: string[], sheet: ImportSheetName, row: number, primaryRequired: boolean) => {
    validateCategory(primary ?? '', sheet, row, 'primary_category', primaryRequired)
    for (const category of secondary) validateCategory(category, sheet, row, 'secondary_categories', true)
    if (primary && secondary.includes(primary)) addIssue('error', sheet, row, 'secondary_categories', 'duplicate_category_role', 'Primary category must not also be secondary.')
  }

  const validateTags = (values: string[], sheet: ImportSheetName, row: number, required: boolean) => {
    if (required && values.length === 0) addIssue('error', sheet, row, 'topic_tags', 'required', 'Add at least one controlled topic tag.')
    for (const tag of values) {
      if (!slugIsValid(tag)) addIssue('error', sheet, row, 'topic_tags', 'invalid_slug', `Tag “${tag}” must be a canonical slug.`)
      const tagDefinition = tags.find(definition => definition.slug === tag)
      if (tagDefinition && !tagDefinition.active) addIssue('error', sheet, row, 'topic_tags', 'inactive_tag', `Tag “${tag}” is inactive and cannot classify imported content.`)
      if (!referencedTags.has(tag)) referencedTags.set(tag, { sheet, row })
    }
  }

  const validatePattern = (value: string, sheet: ImportSheetName, row: number) => {
    if (!value) addIssue('error', sheet, row, 'prompt_pattern', 'required', 'Prompt pattern is required.')
    else if (!PROMPT_PATTERNS.has(value)) addIssue('error', sheet, row, 'prompt_pattern', 'invalid_prompt_pattern', `“${value}” is not an approved prompt pattern.`)
  }

  const validateAnswerType = (value: string | null, sheet: ImportSheetName, row: number, required: boolean) => {
    if (!value) {
      if (required) addIssue('error', sheet, row, 'answer_type', 'required', 'Answer type is required.')
    } else if (!ANSWER_TYPES.has(value)) {
      addIssue('error', sheet, row, 'answer_type', 'invalid_answer_type', `“${value}” is not an approved answer type.`)
    }
  }

  const validateDifficulty = (value: number | null, sheet: ImportSheetName, row: number, required: boolean) => {
    if (value === null) {
      if (required) addIssue('error', sheet, row, 'difficulty', 'required', 'Difficulty is required.')
    } else if (!Number.isInteger(value) || value < 1 || value > 5) {
      addIssue('error', sheet, row, 'difficulty', 'invalid_difficulty', 'Difficulty must be a whole number from 1 to 5.')
    }
  }

  const validateStability = (value: string, sheet: ImportSheetName, row: number): FactualStability => {
    if (!STABILITIES.has(value as FactualStability)) {
      addIssue('error', sheet, row, 'stability', 'invalid_stability', 'Use stable, review_periodically or volatile.')
      return 'stable'
    }
    return value as FactualStability
  }

  const validateStatus = (value: string, sheet: ImportSheetName, row: number): Extract<QuestionStatus, 'draft' | 'needs_review'> => {
    const normalized = value || 'needs_review'
    if (!IMPORTABLE_STATUSES.has(normalized)) {
      addIssue('error', sheet, row, 'status', 'unsafe_status', 'Spreadsheet imports may only create draft or needs_review records. Publish them after editorial review.')
      return 'needs_review'
    }
    return normalized as Extract<QuestionStatus, 'draft' | 'needs_review'>
  }

  const validateMedia = (urlValue: unknown, altValue: unknown, sheet: ImportSheetName, row: number): ImportMedia | null => {
    const url = text(urlValue)
    const alt = text(altValue) || null
    if (!url) return null
    if (!isHttpsUrl(url)) addIssue('error', sheet, row, 'image_url', 'invalid_url', 'Image URL must be a valid HTTPS URL.')
    if (!alt) addIssue('error', sheet, row, 'image_alt', 'missing_alt', 'Image alt text is required when an image is supplied.')
    return { url, alt }
  }

  const validateSource = (row: WorkbookRow, sheet: ImportSheetName): ImportSourceReference => {
    const name = text(valueAt(row, 'source_name')) || null
    const url = text(valueAt(row, 'source_url')) || null
    const rawCheckedDate = valueAt(row, 'source_checked_date')
    const checkedDate = isoDate(rawCheckedDate)
    if (url && !isHttpsUrl(url)) addIssue('error', sheet, row.rowNumber, 'source_url', 'invalid_url', 'Source URL must be a valid HTTPS URL.')
    if (text(rawCheckedDate) && !checkedDate) addIssue('error', sheet, row.rowNumber, 'source_checked_date', 'invalid_date', 'Use a real date in YYYY-MM-DD format.')
    if (url && !name) addIssue('error', sheet, row.rowNumber, 'source_name', 'required_with_source', 'Source name is required when a source URL is supplied.')
    if (url && !checkedDate) addIssue('error', sheet, row.rowNumber, 'source_checked_date', 'required_with_source', 'Source checked date is required when a source URL is supplied.')
    if (!url) addIssue('warning', sheet, row.rowNumber, 'source_url', 'missing_source', 'Add a reliable source before editorial approval.')
    return { name, url, checkedDate }
  }

  const validateDates = (row: WorkbookRow) => {
    const fields = ['as_of_date', 'review_due_at', 'valid_from', 'expires_at'] as const
    const parsed: Record<(typeof fields)[number], string | null> = {
      as_of_date: null, review_due_at: null, valid_from: null, expires_at: null,
    }
    for (const field of fields) {
      const raw = valueAt(row, field)
      parsed[field] = isoDate(raw)
      if (text(raw) && !parsed[field]) addIssue('error', 'Questions', row.rowNumber, field, 'invalid_date', 'Use a real date in YYYY-MM-DD format.')
    }
    if (parsed.valid_from && parsed.expires_at && parsed.valid_from >= parsed.expires_at) {
      addIssue('error', 'Questions', row.rowNumber, 'expires_at', 'invalid_date_range', 'Expiry must be after valid-from date.')
    }
    return parsed
  }

  for (const row of questionRows) {
    const importKey = text(valueAt(row, 'import_key'))
    const prompt = text(valueAt(row, 'prompt'))
    const mechanicValue = text(valueAt(row, 'mechanic'))
    const mechanic = mechanicValue as QuestionMechanic
    const answer = text(valueAt(row, 'answer'))
    const directAliases = pipeList(valueAt(row, 'accepted_answers'))
    const primaryCategory = text(valueAt(row, 'primary_category')) || null
    const secondaryCategories = pipeList(valueAt(row, 'secondary_categories'))
    const topicTags = pipeList(valueAt(row, 'topic_tags'))
    const pattern = text(valueAt(row, 'prompt_pattern'))
    const answerType = text(valueAt(row, 'answer_type')) || null
    const difficulty = text(valueAt(row, 'difficulty')) ? parseInteger(valueAt(row, 'difficulty')) : null
    const stability = validateStability(text(valueAt(row, 'stability')), 'Questions', row.rowNumber)
    const status = validateStatus(text(valueAt(row, 'status')), 'Questions', row.rowNumber)
    const media = validateMedia(valueAt(row, 'image_url'), valueAt(row, 'image_alt'), 'Questions', row.rowNumber)
    const source = validateSource(row, 'Questions')
    const dates = validateDates(row)
    const notes = text(valueAt(row, 'notes')) || null

    if (!importKey) addIssue('error', 'Questions', row.rowNumber, 'import_key', 'required', 'Import key is required.')
    else if (!importKeyIsValid(importKey)) addIssue('error', 'Questions', row.rowNumber, 'import_key', 'invalid_import_key', 'Use permanent lowercase letters, numbers and single hyphens only.')
    else if (questionKeyRows.has(importKey)) addIssue('error', 'Questions', row.rowNumber, 'import_key', 'duplicate_import_key', `Import key “${importKey}” appears more than once.`)
    else questionKeyRows.set(importKey, row)

    if (!prompt) addIssue('error', 'Questions', row.rowNumber, 'prompt', 'required', 'Question prompt is required.')
    const signature = promptSignature(prompt)
    const matchingPrompt = promptRows.get(signature)
    if (signature && matchingPrompt) addIssue('warning', 'Questions', row.rowNumber, 'prompt', 'duplicate_prompt', `Prompt matches row ${matchingPrompt.rowNumber}.`)
    else if (signature) promptRows.set(signature, row)

    if (!MECHANICS.has(mechanic)) addIssue('error', 'Questions', row.rowNumber, 'mechanic', 'invalid_mechanic', `“${mechanicValue}” is not a supported mechanic.`)
    const metadataOnParts = mechanic === 'multi-part'
    validateCategories(primaryCategory, secondaryCategories, 'Questions', row.rowNumber, !metadataOnParts)
    validateTags(topicTags, 'Questions', row.rowNumber, !metadataOnParts)
    validatePattern(pattern, 'Questions', row.rowNumber)
    validateAnswerType(answerType, 'Questions', row.rowNumber, !metadataOnParts)
    validateDifficulty(difficulty, 'Questions', row.rowNumber, !metadataOnParts)
    if (notes?.toLocaleUpperCase().includes('EXAMPLE')) addIssue('error', 'Questions', row.rowNumber, 'notes', 'example_row', 'Delete the yellow example row before importing.')

    const rows = [...(itemRowsByQuestion.get(importKey) ?? [])]
    const seenPositions = new Set<number>()
    const seenLabels = new Set<string>()
    const normalizedItems: Array<{
      row: WorkbookRow
      kind: string
      position: number
      label: string
      displayText: string
      clue: string
      correctAnswer: string
      acceptedAnswers: string[]
      isCorrect: boolean | null
    }> = []

    for (const itemRow of rows) {
      const kind = text(valueAt(itemRow, 'item_kind'))
      const position = parseInteger(valueAt(itemRow, 'position'))
      const label = text(valueAt(itemRow, 'label'))
      const displayText = text(valueAt(itemRow, 'display_text'))
      const clue = text(valueAt(itemRow, 'clue'))
      const correctAnswer = text(valueAt(itemRow, 'correct_answer'))
      const acceptedAnswers = pipeList(valueAt(itemRow, 'accepted_answers'))
      const isCorrect = parseBoolean(valueAt(itemRow, 'is_correct'))

      if (!ITEM_KINDS.has(kind)) addIssue('error', 'Question Items', itemRow.rowNumber, 'item_kind', 'invalid_item_kind', `“${kind}” is not a supported item kind.`)
      if (position === null || position < 1) addIssue('error', 'Question Items', itemRow.rowNumber, 'position', 'invalid_position', 'Position must be a positive whole number.')
      else if (seenPositions.has(position)) addIssue('error', 'Question Items', itemRow.rowNumber, 'position', 'duplicate_position', `Position ${position} is repeated for “${importKey}”.`)
      else seenPositions.add(position)

      if (label && seenLabels.has(label.toLocaleLowerCase())) addIssue('error', 'Question Items', itemRow.rowNumber, 'label', 'duplicate_label', `Label “${label}” is repeated for “${importKey}”.`)
      else if (label) seenLabels.add(label.toLocaleLowerCase())

      normalizedItems.push({ row: itemRow, kind, position: position ?? 0, label, displayText, clue, correctAnswer, acceptedAnswers, isCorrect })
    }

    normalizedItems.sort((a, b) => a.position - b.position)
    normalizedItems.forEach((item, index) => {
      if (item.position !== index + 1) {
        addIssue('error', 'Question Items', item.row.rowNumber, 'position', 'position_gap', `Positions for “${importKey}” must run consecutively from 1.`)
      }
    })
    let correctAnswer: ImportQuestion['correctAnswer'] = answer
    let acceptedAnswers: ImportQuestion['acceptedAnswers'] = directAliases
    let options: ImportQuestion['options'] = null
    const parts: ImportQuestionPart[] = []

    if (mechanic === 'single-answer') {
      if (!answer) addIssue('error', 'Questions', row.rowNumber, 'answer', 'required', 'Single-answer question needs an answer.')
      if (normalizedItems.length > 0) addIssue('error', 'Question Items', normalizedItems[0].row.rowNumber, 'item_kind', 'unexpected_items', 'Single-answer questions do not use Question Items rows.')
    } else if (mechanic === 'multiple-choice') {
      const choices = normalizedItems.filter(item => item.kind === 'choice')
      if (choices.length !== normalizedItems.length) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'item_kind', 'wrong_item_kind', 'Multiple-choice questions may only use choice rows.')
      if (choices.length !== 4) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'item_kind', 'choice_count', 'Multiple-choice questions currently require exactly four choices.')
      for (const choice of choices) {
        if (!choice.label) addIssue('error', 'Question Items', choice.row.rowNumber, 'label', 'required', 'Choice label is required.')
        if (!choice.displayText) addIssue('error', 'Question Items', choice.row.rowNumber, 'display_text', 'required', 'Choice text is required.')
        if (choice.isCorrect === null) addIssue('error', 'Question Items', choice.row.rowNumber, 'is_correct', 'invalid_boolean', 'Use TRUE or FALSE.')
      }
      const correctChoices = choices.filter(choice => choice.isCorrect)
      choices.forEach((choice, index) => {
        const expectedLabel = String.fromCharCode(65 + index)
        if (choice.label !== expectedLabel) addIssue('error', 'Question Items', choice.row.rowNumber, 'label', 'invalid_choice_label', `Choice ${index + 1} must use label ${expectedLabel}.`)
      })
      if (correctChoices.length !== 1) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'is_correct', 'correct_choice_count', 'Mark exactly one choice as correct.')
      correctAnswer = correctChoices[0]?.label || ''
      acceptedAnswers = []
      options = choices.map(choice => ({ key: choice.label, label: choice.displayText }))
      if (answer || directAliases.length > 0) addIssue('warning', 'Questions', row.rowNumber, 'answer', 'ignored_direct_answer', 'Multiple-choice answer fields are derived from Question Items.')
    } else if (mechanic === 'multi-answer') {
      const answers = normalizedItems.filter(item => item.kind === 'answer')
      if (answers.length !== normalizedItems.length) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'item_kind', 'wrong_item_kind', 'Multi-answer questions may only use answer rows.')
      if (answers.length < 2) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'item_kind', 'answer_count', 'Multi-answer questions need at least two answers.')
      for (const item of answers) if (!item.correctAnswer) addIssue('error', 'Question Items', item.row.rowNumber, 'correct_answer', 'required', 'Correct answer is required.')
      const normalizedAnswers = answers.map(item => normalizedComparable(item.correctAnswer)).filter(Boolean)
      if (new Set(normalizedAnswers).size !== normalizedAnswers.length) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'correct_answer', 'duplicate_answer', 'Correct answers must be unique after normalization.')
      correctAnswer = answers.map(item => item.correctAnswer)
      acceptedAnswers = answers.map(item => item.acceptedAnswers)
      if (answer || directAliases.length > 0) addIssue('warning', 'Questions', row.rowNumber, 'answer', 'ignored_direct_answer', 'Multi-answer values are derived from Question Items.')
    } else if (mechanic === 'multi-part') {
      const partItems = normalizedItems.filter(item => item.kind === 'part')
      if (partItems.length !== normalizedItems.length) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'item_kind', 'wrong_item_kind', 'Multi-part questions may only use part rows.')
      if (partItems.length < 2) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'item_kind', 'part_count', 'Multi-part questions need at least two parts.')
      for (const item of partItems) {
        const partPrimaryCategory = text(valueAt(item.row, 'primary_category'))
        const partSecondaryCategories = pipeList(valueAt(item.row, 'secondary_categories'))
        const partTags = pipeList(valueAt(item.row, 'topic_tags'))
        const partPattern = text(valueAt(item.row, 'prompt_pattern'))
        const partAnswerType = text(valueAt(item.row, 'answer_type'))
        const partDifficulty = parseInteger(valueAt(item.row, 'difficulty'))
        const partStability = validateStability(text(valueAt(item.row, 'stability')), 'Question Items', item.row.rowNumber)
        const imageUrl = text(valueAt(item.row, 'image_url'))
        const partMedia = imageUrl ? { url: imageUrl, alt: null } : null

        if (!item.label) addIssue('error', 'Question Items', item.row.rowNumber, 'label', 'required', 'Part label is required.')
        if (!item.clue) addIssue('error', 'Question Items', item.row.rowNumber, 'clue', 'required', 'Part clue is required.')
        if (!item.correctAnswer) addIssue('error', 'Question Items', item.row.rowNumber, 'correct_answer', 'required', 'Part answer is required.')
        validateCategories(partPrimaryCategory, partSecondaryCategories, 'Question Items', item.row.rowNumber, true)
        validateTags(partTags, 'Question Items', item.row.rowNumber, true)
        validatePattern(partPattern, 'Question Items', item.row.rowNumber)
        validateAnswerType(partAnswerType, 'Question Items', item.row.rowNumber, true)
        validateDifficulty(partDifficulty, 'Question Items', item.row.rowNumber, true)
        if (imageUrl && !isHttpsUrl(imageUrl)) addIssue('error', 'Question Items', item.row.rowNumber, 'image_url', 'invalid_url', 'Image URL must be a valid HTTPS URL.')

        if (item.position > 0 && item.label && item.clue && item.correctAnswer && partDifficulty !== null) {
          parts.push({
            position: item.position,
            label: item.label,
            prompt: item.clue,
            correctAnswer: item.correctAnswer,
            acceptedAnswers: item.acceptedAnswers,
            primaryCategory: partPrimaryCategory,
            secondaryCategories: partSecondaryCategories,
            tags: partTags,
            promptPattern: partPattern,
            answerType: partAnswerType,
            editorialDifficulty: partDifficulty,
            stability: partStability,
            media: partMedia,
          })
        }
      }
      correctAnswer = partItems.map(item => item.correctAnswer)
      acceptedAnswers = partItems.map(item => item.acceptedAnswers)
      options = partItems.map(item => ({ label: item.label, clue: item.clue }))
      if (answer || directAliases.length > 0) addIssue('warning', 'Questions', row.rowNumber, 'answer', 'ignored_direct_answer', 'Multi-part values are derived from Question Items.')
    } else if (mechanic === 'ranking') {
      const rankingItems = normalizedItems.filter(item => item.kind === 'ranking_item')
      if (rankingItems.length !== normalizedItems.length) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'item_kind', 'wrong_item_kind', 'Ranking questions may only use ranking_item rows.')
      if (rankingItems.length < 2) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'item_kind', 'ranking_count', 'Ranking questions need at least two items.')
      for (const item of rankingItems) if (!item.displayText) addIssue('error', 'Question Items', item.row.rowNumber, 'display_text', 'required', 'Ranking item text is required.')
      const normalizedRankingItems = rankingItems.map(item => normalizedComparable(item.displayText)).filter(Boolean)
      if (new Set(normalizedRankingItems).size !== normalizedRankingItems.length) addIssue('error', 'Question Items', rows[0]?.rowNumber ?? null, 'display_text', 'duplicate_ranking_item', 'Ranking items must be unique after normalization.')
      correctAnswer = rankingItems.map(item => item.displayText)
      acceptedAnswers = []
      options = rankingItems.map(item => item.displayText)
      if (answer || directAliases.length > 0) addIssue('warning', 'Questions', row.rowNumber, 'answer', 'ignored_direct_answer', 'Ranking order is derived from Question Items.')
    }

    let bonus: ImportBonus | null = null
    const bonusRow = bonusRowByQuestion.get(importKey)
    if (bonusRow) {
      const bonusPrompt = text(valueAt(bonusRow, 'prompt'))
      const bonusAnswer = text(valueAt(bonusRow, 'correct_answer'))
      const bonusPoints = parseInteger(valueAt(bonusRow, 'points'))
      const bonusPrimaryCategory = text(valueAt(bonusRow, 'primary_category'))
      const bonusSecondaryCategories = pipeList(valueAt(bonusRow, 'secondary_categories'))
      const bonusTags = pipeList(valueAt(bonusRow, 'topic_tags'))
      const bonusPattern = text(valueAt(bonusRow, 'prompt_pattern'))
      const bonusAnswerType = text(valueAt(bonusRow, 'answer_type'))
      const bonusDifficulty = parseInteger(valueAt(bonusRow, 'difficulty'))
      const bonusStability = validateStability(text(valueAt(bonusRow, 'stability')), 'Bonuses', bonusRow.rowNumber)
      const bonusMedia = validateMedia(valueAt(bonusRow, 'image_url'), valueAt(bonusRow, 'image_alt'), 'Bonuses', bonusRow.rowNumber)
      const bonusNotes = text(valueAt(bonusRow, 'notes')) || null
      const bonusSource = validateSource(bonusRow, 'Bonuses')
      if (!bonusPrompt) addIssue('error', 'Bonuses', bonusRow.rowNumber, 'prompt', 'required', 'Bonus prompt is required.')
      if (!bonusAnswer) addIssue('error', 'Bonuses', bonusRow.rowNumber, 'correct_answer', 'required', 'Bonus answer is required.')
      if (bonusPoints === null || bonusPoints < 1) addIssue('error', 'Bonuses', bonusRow.rowNumber, 'points', 'invalid_points', 'Bonus points must be a positive whole number.')
      validateCategories(bonusPrimaryCategory, bonusSecondaryCategories, 'Bonuses', bonusRow.rowNumber, true)
      validateTags(bonusTags, 'Bonuses', bonusRow.rowNumber, true)
      validatePattern(bonusPattern, 'Bonuses', bonusRow.rowNumber)
      validateAnswerType(bonusAnswerType, 'Bonuses', bonusRow.rowNumber, true)
      validateDifficulty(bonusDifficulty, 'Bonuses', bonusRow.rowNumber, true)
      if (bonusNotes?.toLocaleUpperCase().includes('EXAMPLE')) addIssue('error', 'Bonuses', bonusRow.rowNumber, 'notes', 'example_row', 'Delete the yellow example row before importing.')
      if (bonusPrompt && bonusAnswer && bonusPoints !== null && bonusPoints > 0 && bonusDifficulty !== null) {
        bonus = {
          prompt: bonusPrompt,
          correctAnswer: bonusAnswer,
          acceptedAnswers: pipeList(valueAt(bonusRow, 'accepted_answers')),
          points: bonusPoints,
          primaryCategory: bonusPrimaryCategory,
          secondaryCategories: bonusSecondaryCategories,
          tags: bonusTags,
          promptPattern: bonusPattern,
          answerType: bonusAnswerType,
          editorialDifficulty: bonusDifficulty,
          stability: bonusStability,
          media: bonusMedia,
          notes: bonusNotes,
          source: bonusSource,
        }
      }
    }

    if (importKey && prompt && MECHANICS.has(mechanic)) {
      questions.push({
        importKey,
        prompt,
        mechanic,
        correctAnswer,
        acceptedAnswers,
        options,
        primaryCategory,
        secondaryCategories,
        tags: topicTags,
        promptPattern: pattern,
        answerType,
        editorialDifficulty: difficulty,
        stability,
        asOfDate: dates.as_of_date,
        reviewDueAt: dates.review_due_at,
        validFrom: dates.valid_from,
        expiresAt: dates.expires_at,
        media,
        notes,
        status,
        source,
        promptSignature: signature,
        parts,
        bonus,
      })
    }
  }

  for (const [key, rows] of itemRowsByQuestion) {
    if (!questionKeyRows.has(key)) addIssue('error', 'Question Items', rows[0].rowNumber, 'question_import_key', 'missing_parent', `No Questions row uses “${key}”.`)
  }
  for (const [key, row] of bonusRowByQuestion) {
    if (!questionKeyRows.has(key)) addIssue('error', 'Bonuses', row.rowNumber, 'question_import_key', 'missing_parent', `No Questions row uses “${key}”.`)
  }

  for (const [tag, location] of referencedTags) {
    if (!tagRowBySlug.has(tag)) addIssue('warning', location.sheet, location.row, 'topic_tags', 'external_tag', `Tag “${tag}” must already exist in the database or be added to Tags.`)
  }

  const tiebreakers: ImportTiebreaker[] = []
  const tiebreakerKeys = new Set<string>()
  for (const row of tiebreakerRows) {
    const importKey = text(valueAt(row, 'import_key'))
    const prompt = text(valueAt(row, 'prompt'))
    const correctValue = parseNumber(valueAt(row, 'correct_numeric_answer'))
    const notes = text(valueAt(row, 'notes')) || null
    const tiebreakerSource = validateSource(row, 'Tiebreakers')
    if (!importKey) addIssue('error', 'Tiebreakers', row.rowNumber, 'import_key', 'required', 'Import key is required.')
    else if (!importKeyIsValid(importKey)) addIssue('error', 'Tiebreakers', row.rowNumber, 'import_key', 'invalid_import_key', 'Use permanent lowercase letters, numbers and single hyphens only.')
    else if (tiebreakerKeys.has(importKey)) addIssue('error', 'Tiebreakers', row.rowNumber, 'import_key', 'duplicate_import_key', `Import key “${importKey}” appears more than once.`)
    else tiebreakerKeys.add(importKey)
    if (!prompt) addIssue('error', 'Tiebreakers', row.rowNumber, 'prompt', 'required', 'Tiebreaker prompt is required.')
    if (correctValue === null) addIssue('error', 'Tiebreakers', row.rowNumber, 'correct_numeric_answer', 'invalid_number', 'Correct answer must be numeric.')
    if (notes?.toLocaleUpperCase().includes('EXAMPLE')) addIssue('error', 'Tiebreakers', row.rowNumber, 'notes', 'example_row', 'Delete the yellow example row before importing.')
    const status = validateStatus(text(valueAt(row, 'status')), 'Tiebreakers', row.rowNumber)
    if (importKey && prompt && correctValue !== null) {
      tiebreakers.push({
        importKey,
        prompt,
        correctValue,
        answerUnit: text(valueAt(row, 'answer_unit')) || null,
        notes,
        status,
        source: tiebreakerSource,
      })
    }
  }

  const errors = issues.filter(issue => issue.severity === 'error')
  return {
    valid: errors.length === 0,
    issues,
    plan: errors.length === 0 ? { version: QUESTION_LIBRARY_IMPORT_VERSION, questions, tiebreakers, tags } : null,
  }
}

export function importPlanCounts(plan: QuestionLibraryImportPlan) {
  return {
    questions: plan.questions.length,
    questionParts: plan.questions.reduce((total, question) => total + question.parts.length, 0),
    bonuses: plan.questions.filter(question => question.bonus !== null).length,
    tiebreakers: plan.tiebreakers.length,
    tags: plan.tags.length,
  }
}
