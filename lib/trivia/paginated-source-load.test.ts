import { describe, expect, it, vi } from 'vitest'

import { loadAllSourceRows } from './paginated-source-load'

describe('paginated source loading', () => {
  it('loads every row when the library exceeds one API page', async () => {
    const loadPage = vi.fn(async (from: number, to: number) => ({
      data: Array.from({ length: from === 0 ? 1000 : 103 }, (_, index) => from + index),
      error: null,
      requestedTo: to,
    }))

    const result = await loadAllSourceRows(loadPage)

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1103)
    expect(loadPage).toHaveBeenNthCalledWith(1, 0, 999)
    expect(loadPage).toHaveBeenNthCalledWith(2, 1000, 1999)
  })

  it('stops after the first partial page', async () => {
    const loadPage = vi.fn(async () => ({ data: [1, 2, 3], error: null }))

    await expect(loadAllSourceRows(loadPage)).resolves.toEqual({ data: [1, 2, 3], error: null })
    expect(loadPage).toHaveBeenCalledTimes(1)
  })

  it('returns an API error without exposing a partial library', async () => {
    const failure = new Error('database unavailable')
    const loadPage = vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 2 }, (_, index) => index), error: null })
      .mockResolvedValueOnce({ data: null, error: failure })

    await expect(loadAllSourceRows(loadPage, 2)).resolves.toEqual({ data: null, error: failure })
  })
})
