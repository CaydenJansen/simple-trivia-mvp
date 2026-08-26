export const CLIENT_ERROR_MAX_LENGTH = 4_000

export type ClientErrorKind = 'error' | 'unhandled-rejection' | 'react-boundary'

export type ClientErrorReport = {
  kind: ClientErrorKind
  message: string
  stack: string | null
  digest: string | null
  path: string
  userAgent: string
  occurredAt: string
}

function cleanText(value: unknown, maxLength = CLIENT_ERROR_MAX_LENGTH) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength)
}

function cleanPath(value: unknown) {
  const path = cleanText(value, 500)
  if (!path.startsWith('/')) return '/'
  return path.split('?')[0].split('#')[0]
}

export function normalizeClientErrorReport(value: unknown): ClientErrorReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const input = value as Record<string, unknown>
  const message = cleanText(input.message)
  if (!message) return null

  const kind: ClientErrorKind = input.kind === 'unhandled-rejection' || input.kind === 'react-boundary'
    ? input.kind
    : 'error'
  const occurredAt = cleanText(input.occurredAt, 100)

  return {
    kind,
    message,
    stack: cleanText(input.stack) || null,
    digest: cleanText(input.digest, 200) || null,
    path: cleanPath(input.path),
    userAgent: cleanText(input.userAgent, 500),
    occurredAt: Number.isNaN(Date.parse(occurredAt)) ? new Date().toISOString() : occurredAt,
  }
}

export function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message || value.name
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return 'Unknown client error'
  }
}

export function errorStack(value: unknown) {
  return value instanceof Error ? value.stack ?? null : null
}
