function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function unique(values: string[]) {
  const seen = new Set<string>()
  return values.filter(value => {
    const key = normalized(value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function splitAlternatives(value: string) {
  return value
    .split(/\s*\/\s*|\s+or\s+/iu)
    .map(part => part.trim())
    .filter(Boolean)
}

function parentheticalAliases(value: string) {
  const aliases: string[] = []
  const normalizedApostrophes = value.replace(/[’‘]/g, "'")
  const alsoAccepted = normalizedApostrophes.match(/(?:we(?:'ll)?\s+)?also accept\s+(.+)/iu)?.[1]
  if (alsoAccepted) {
    const explicitAnswer = alsoAccepted
      .replace(/^(?:(?:his|her|their|the)\s+)?real name\s*,\s*/iu, '')
      .replace(/[.!]+$/u, '')
    aliases.push(...splitAlternatives(explicitAnswer))
  }

  const parentheticalAlternative = normalizedApostrophes.match(/^\s*(?:or|aka|a\.k\.a\.?)\s+(.+)/iu)?.[1]
  if (parentheticalAlternative) aliases.push(...splitAlternatives(parentheticalAlternative.replace(/[.!]+$/u, '')))

  const knownAs = normalizedApostrophes.match(/known as\s+(.+?)(?:\s+in some\b|\s+so\b|[.!]|$)/iu)?.[1]
  if (knownAs) aliases.push(...splitAlternatives(knownAs))
  return aliases
}

export type AnswerVariants = {
  primary: string
  accepted: string[]
}

/**
 * Converts legacy answer display copy into grading candidates. Historical quiz
 * archives often stored pronunciation notes and alternatives in the primary
 * answer cell instead of the accepted-alias column.
 */
export function answerVariants(value: string): AnswerVariants {
  const original = value.trim()
  if (!original) return { primary: '', accepted: [] }

  const parentheticalNotes = [...original.matchAll(/\(([^()]*)\)/gu)].map(match => match[1])
  const outsideWithoutNotes = original.replace(/\s*\([^()]*\)\s*/gu, ' ').replace(/\s+/gu, ' ').trim()
  const prefixBeforeNote = original.match(/^(.*?)\s*\(/u)?.[1].trim() ?? ''
  const outside = prefixBeforeNote || outsideWithoutNotes || original
  const alternatives = splitAlternatives(outside)
  const primary = alternatives[0] ?? outside
  const accepted = unique([
    ...alternatives.slice(1),
    ...splitAlternatives(outsideWithoutNotes),
    ...parentheticalNotes.flatMap(parentheticalAliases),
    original,
  ]).filter(candidate => normalized(candidate) !== normalized(primary))

  return { primary, accepted }
}

export function answerCandidates(primary: string, configuredAliases: string[] = []) {
  const values = [answerVariants(primary), ...configuredAliases.map(answerVariants)]
  return unique(values.flatMap(value => [value.primary, ...value.accepted]))
}
