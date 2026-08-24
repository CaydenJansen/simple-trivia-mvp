type PageResult<T> = {
  data: T[] | null
  error: unknown | null
}

export async function loadAllSourceRows<T>(
  loadPage: (from: number, to: number) => Promise<PageResult<T>>,
  pageSize = 1000,
): Promise<PageResult<T>> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('Page size must be a positive whole number.')
  }

  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const result = await loadPage(from, from + pageSize - 1)
    if (result.error) return { data: null, error: result.error }

    const page = result.data ?? []
    rows.push(...page)
    if (page.length < pageSize) return { data: rows, error: null }
  }
}
