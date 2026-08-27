'use client'

import { useEffect } from 'react'

import { reportClientError } from '@/lib/monitoring/report-client-error'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportClientError(error, 'react-boundary', error.digest)
  }, [error])

  return (
    <html lang="en">
      <body>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f7f6ff', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
          <section style={{ width: '100%', maxWidth: 420, borderRadius: 24, background: '#fff', padding: 32, boxShadow: '0 10px 30px rgba(24, 23, 31, 0.08)' }}>
            <h1 style={{ margin: 0, color: '#18171f', fontSize: 26 }}>Good Trivia Company needs to reload</h1>
            <p style={{ margin: '12px 0 0', color: '#6b6880', lineHeight: 1.6 }}>Any already-saved game data is safe.</p>
            <button type="button" onClick={reset} style={{ width: '100%', marginTop: 24, border: 0, borderRadius: 12, padding: '13px 16px', background: '#7c3aed', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              Reload Good Trivia Company
            </button>
          </section>
        </main>
      </body>
    </html>
  )
}
