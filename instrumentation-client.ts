import { reportClientError } from '@/lib/monitoring/report-client-error'

try {
  window.addEventListener('error', event => {
    reportClientError(event.error ?? event.message, 'error')
  })

  window.addEventListener('unhandledrejection', event => {
    reportClientError(event.reason, 'unhandled-rejection')
  })
} catch {
  // Monitoring must never prevent the application from hydrating.
}
