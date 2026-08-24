import { describe, expect, it } from 'vitest'

import { sourceQuestionSearchOrFilter } from './source-question-search'

const categories = [
  { id: 'category-science', name: 'Science & Nature' },
  { id: 'category-history', name: 'History' },
]

const tags = [
  { id: 'tag-space', name: 'Space Exploration' },
  { id: 'tag-world-war', name: 'World War II' },
]

describe('source question search', () => {
  it('always searches question text', () => {
    expect(sourceQuestionSearchOrFilter('gold symbol', categories, tags)).toBe('prompt.ilike.*gold*symbol*')
  })

  it('also searches matching categories and topic tags', () => {
    expect(sourceQuestionSearchOrFilter('science', categories, tags)).toBe(
      'prompt.ilike.*science*,category_ids.ov.{category-science}',
    )
    expect(sourceQuestionSearchOrFilter('space', categories, tags)).toBe(
      'prompt.ilike.*space*,tag_ids.ov.{tag-space}',
    )
  })

  it('normalizes punctuation and ignores empty searches', () => {
    expect(sourceQuestionSearchOrFilter('World-War!', categories, tags)).toBe(
      'prompt.ilike.*world*war*,tag_ids.ov.{tag-world-war}',
    )
    expect(sourceQuestionSearchOrFilter('---', categories, tags)).toBeNull()
  })
})
