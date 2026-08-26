import { NextRequest, NextResponse } from 'next/server'

import { normalizeClientErrorReport } from '@/lib/monitoring/client-error'

const MAX_REQUEST_BYTES = 12_000

export async function POST(request: NextRequest) {
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
    return NextResponse.json({ ok: false }, { status: 403 })
  }

  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ ok: false }, { status: 415 })
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }

  let input: unknown
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const report = normalizeClientErrorReport(input)
  if (!report) return NextResponse.json({ ok: false }, { status: 400 })

  console.error('[simple-trivia-client-error]', JSON.stringify({
    ...report,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  }))

  return NextResponse.json({ ok: true }, { status: 202 })
}
