export type SourceQuestionPreviewKind =
  | 'single-answer'
  | 'multiple-choice'
  | 'multi-answer'
  | 'multi-part'
  | 'ranking'

export type SourceQuestionPreviewRow = {
  label: string | null
  prompt: string | null
  answer: string
  aliases: string[]
  correct: boolean
}

export type SourceQuestionPreview = {
  kind: SourceQuestionPreviewKind
  rows: SourceQuestionPreviewRow[]
}

type PreviewInput = {
  questionType: string
  correctAnswer: unknown
  acceptedAnswers: unknown
  options: unknown
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item ?? '')) : []
}

function aliasesAt(value: unknown, index: number) {
  if (!Array.isArray(value)) return []
  const aliases = value[index]
  return Array.isArray(aliases) ? aliases.map(item => String(item ?? '')).filter(Boolean) : []
}

function optionRows(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>
      return {
        key: String(record.key ?? record.label ?? String.fromCharCode(65 + index)),
        label: String(record.label ?? String.fromCharCode(65 + index)),
        clue: String(record.clue ?? ''),
      }
    }
    return {
      key: String.fromCharCode(65 + index),
      label: String(item ?? ''),
      clue: '',
    }
  })
}

export function sourceQuestionPreview(input: PreviewInput): SourceQuestionPreview {
  const answers = stringArray(input.correctAnswer)

  if (input.questionType === 'multiple-choice') {
    const correctKey = String(input.correctAnswer ?? '')
    return {
      kind: 'multiple-choice',
      rows: optionRows(input.options).map(option => ({
        label: option.key,
        prompt: null,
        answer: option.label,
        aliases: [],
        correct: option.key === correctKey,
      })),
    }
  }

  if (input.questionType === 'multi-part') {
    const parts = optionRows(input.options)
    return {
      kind: 'multi-part',
      rows: answers.map((answer, index) => ({
        label: parts[index]?.label || String.fromCharCode(65 + index),
        prompt: parts[index]?.clue || null,
        answer,
        aliases: aliasesAt(input.acceptedAnswers, index),
        correct: true,
      })),
    }
  }

  if (input.questionType === 'multi-answer') {
    return {
      kind: 'multi-answer',
      rows: answers.map((answer, index) => ({
        label: String(index + 1),
        prompt: null,
        answer,
        aliases: aliasesAt(input.acceptedAnswers, index),
        correct: true,
      })),
    }
  }

  if (input.questionType === 'ranking') {
    return {
      kind: 'ranking',
      rows: answers.map((answer, index) => ({
        label: String(index + 1),
        prompt: null,
        answer,
        aliases: [],
        correct: true,
      })),
    }
  }

  const aliases = Array.isArray(input.acceptedAnswers)
    ? input.acceptedAnswers.map(item => String(item ?? '')).filter(Boolean)
    : []
  return {
    kind: 'single-answer',
    rows: [{
      label: null,
      prompt: null,
      answer: String(input.correctAnswer ?? ''),
      aliases,
      correct: true,
    }],
  }
}
