import {
  errorMessage,
  errorStack,
  type ClientErrorKind,
} from './client-error'

const recentlyReported = new Map<string, number>()
const DEDUPE_WINDOW_MS = 30_000

export function reportClientError(
  error: unknown,
  kind: ClientErrorKind = 'error',
  digest?: string,
) {
  if (typeof window === 'undefined') return

  const message = errorMessage(error)
  const signature = `${kind}:${message}:${digest ?? ''}:${window.location.pathname}`
  const now = Date.now()
  const lastReportedAt = recentlyReported.get(signature) ?? 0
  if (now - lastReportedAt < DEDUPE_WINDOW_MS) return
  recentlyReported.set(signature, now)

  for (const [key, timestamp] of recentlyReported) {
    if (now - timestamp > DEDUPE_WINDOW_MS) recentlyReported.delete(key)
  }

  const body = JSON.stringify({
    kind,
    message,
    stack: errorStack(error),
    digest: digest ?? null,
    path: window.location.pathname,
    userAgent: window.navigator.userAgent,
    occurredAt: new Date(now).toISOString(),
  })

  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Monitoring must never interrupt a live game or create a second error.
    })
  } catch {
    // Monitoring must never interrupt a live game or create a second error.
  }
}
