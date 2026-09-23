const HOST_JOIN_SLUG_PATTERN = /^[a-z0-9]{16,32}$/

export function normalizeHostJoinSlug(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? ''
  return HOST_JOIN_SLUG_PATTERN.test(normalized) ? normalized : null
}

export function buildPermanentHostJoinUrl(origin: string, slug: string) {
  const normalized = normalizeHostJoinSlug(slug)
  if (!normalized) throw new Error('Invalid permanent host link')
  const url = new URL('/join', origin)
  url.searchParams.set('host', normalized)
  return url.toString()
}

export function hostJoinSlugFromSearch(search: string) {
  return normalizeHostJoinSlug(new URLSearchParams(search).get('host'))
}
