import { describe, expect, it } from 'vitest'
import { buildPermanentHostJoinUrl, hostJoinSlugFromSearch, normalizeHostJoinSlug } from './permanent-host-link'

describe('permanent host links', () => {
  it('builds and reads a stable public URL', () => {
    const slug = 'abc123def456ghi789jk'
    const url = buildPermanentHostJoinUrl('https://goodtrivia.example', slug)
    expect(url).toBe(`https://goodtrivia.example/join?host=${slug}`)
    expect(hostJoinSlugFromSearch(new URL(url).search)).toBe(slug)
  })

  it('normalizes safe slugs and rejects malformed values', () => {
    expect(normalizeHostJoinSlug(' ABC123DEF456GHI7 ')).toBe('abc123def456ghi7')
    expect(normalizeHostJoinSlug('../host')).toBeNull()
    expect(normalizeHostJoinSlug('short')).toBeNull()
  })
})
