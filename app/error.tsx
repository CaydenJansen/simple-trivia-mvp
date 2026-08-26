'use client'

import { useEffect } from 'react'

import { reportClientError } from '@/lib/monitoring/report-client-error'

export default function ErrorPage({
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
    <main className="flex min-h-screen items-center justify-center bg-[#f7f6ff] px-6 text-center">
      <section className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-xl">↻</div>
        <h1 className="text-2xl font-bold text-zinc-900">Something went wrong</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Any already-saved game data is safe. Try loading this screen again.
        </p>
        <button type="button" onClick={reset} className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white hover:bg-violet-700">
          Try again
        </button>
      </section>
    </main>
  )
}
