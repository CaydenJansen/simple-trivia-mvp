export function numericResponseDigits(value: string) {
  // Do not silently turn a malformed guess into a different valid number.
  return value.trim().replace(/[−﹣－]/g, '-').replace(/,/g, '')
}

export function formatNumericResponseInput(value: string) {
  const normalized = numericResponseDigits(value)
  if (!/^-?\d*(?:\.\d*)?$/.test(normalized)) return normalized
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return normalized
  const negative = normalized.startsWith('-') ? '-' : ''
  const unsigned = negative ? normalized.slice(1) : normalized
  const [whole, decimal] = unsigned.split('.')
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative}${grouped}${decimal !== undefined ? `.${decimal}` : ''}`
}

export function parseNumericResponseInput(value: string) {
  const normalized = numericResponseDigits(value)
  if (!/^-?\d*(?:\.\d*)?$/.test(normalized)) return null
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function formatNumericResponse(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return ''
  const parsed = typeof value === 'number' ? value : parseNumericResponseInput(value)
  return parsed === null ? String(value) : new Intl.NumberFormat('en-AU', { maximumFractionDigits: 20 }).format(parsed)
}
