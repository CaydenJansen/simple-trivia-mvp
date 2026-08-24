import { describe, expect, it } from 'vitest'

import { sourceQuestionSearchOrFilter } from './source-question-search'

const categories = [
  { id: 'category-science', name: 'Science & Nature' },
  { id: 'category-history', name: 'History' },
  { id: 'category-film', name: 'Film & Television' },
]

const tags = [
  { id: 'tag-space', name: 'Space Exploration' },
  { id: 'tag-world-war', name: 'World War II' },
  { id: 'tag-films', name: 'Films' },
]

const tagAliases = [
  { tag_id: 'tag-space', alias: 'Outer Space' },
]

describe('source question search', () => {
  it('always searches question text', () => {
    expect(sourceQuestionSearchOrFilter('gold symbol', categories, tags)).toBe('prompt.wfts(english).gold symbol')
  })

  it('also searches matching categories and topic tags', () => {
    expect(sourceQuestionSearchOrFilter('science', categories, tags)).toBe(
      'prompt.wfts(english).science,category_ids.ov.{category-science}',
    )
    expect(sourceQuestionSearchOrFilter('space', categories, tags)).toBe(
      'prompt.wfts(english).space,tag_ids.ov.{tag-space}',
    )
  })

  it('normalizes punctuation and ignores empty searches', () => {
    expect(sourceQuestionSearchOrFilter('World-War!', categories, tags)).toBe(
      'prompt.wfts(english).world war,tag_ids.ov.{tag-world-war}',
    )
    expect(sourceQuestionSearchOrFilter('---', categories, tags)).toBeNull()
  })

  it('expands common category language such as movies and film', () => {
    expect(sourceQuestionSearchOrFilter('movies', categories, tags)).toBe(
      'prompt.wfts(english).movies,prompt.wfts(english).movie,prompt.wfts(english).film,prompt.wfts(english).films,prompt.wfts(english).cinema,prompt.wfts(english).television,prompt.wfts(english).tv,category_ids.ov.{category-film},tag_ids.ov.{tag-films}',
    )
  })

  it('matches controlled tag aliases without requiring them in the question text', () => {
    expect(sourceQuestionSearchOrFilter('outer space', categories, tags, tagAliases)).toBe(
      'prompt.wfts(english).outer space,tag_ids.ov.{tag-space}',
    )
  })

  it('uses whole-word text search instead of matching inside unrelated words', () => {
    expect(sourceQuestionSearchOrFilter('ball', categories, tags)).toBe('prompt.wfts(english).ball')
    expect(sourceQuestionSearchOrFilter('art', categories, tags)).toBe(
      'prompt.wfts(english).art,prompt.wfts(english).arts',
    )
  })
})
