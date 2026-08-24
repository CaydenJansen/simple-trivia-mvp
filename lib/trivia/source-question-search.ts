export type SourceQuestionSearchTaxonomyItem = {
  id: string
  name: string
}

function normalizedSearchText(value: string) {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function sourceQuestionSearchOrFilter(
  search: string,
  categories: readonly SourceQuestionSearchTaxonomyItem[],
  tags: readonly SourceQuestionSearchTaxonomyItem[],
) {
  const normalizedSearch = normalizedSearchText(search)
  if (!normalizedSearch) return null

  const promptPattern = normalizedSearch.split(' ').join('*')
  const matchingCategoryIds = categories
    .filter(category => normalizedSearchText(category.name).includes(normalizedSearch))
    .map(category => category.id)
  const matchingTagIds = tags
    .filter(tag => normalizedSearchText(tag.name).includes(normalizedSearch))
    .map(tag => tag.id)

  return [
    `prompt.ilike.*${promptPattern}*`,
    matchingCategoryIds.length > 0 ? `category_ids.ov.{${matchingCategoryIds.join(',')}}` : null,
    matchingTagIds.length > 0 ? `tag_ids.ov.{${matchingTagIds.join(',')}}` : null,
  ].filter(Boolean).join(',')
}
