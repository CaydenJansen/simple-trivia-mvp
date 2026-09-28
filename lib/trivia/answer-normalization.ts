/** Ignore decorative punctuation, but never turn a negative quantity positive. */
export function normalizeAnswerText(value: string) {
  return value.trim().toLowerCase()
    .replace(/(?<![\p{L}\p{N}])[-−﹣－]\s*(?=\d)/gu, ' negative ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
