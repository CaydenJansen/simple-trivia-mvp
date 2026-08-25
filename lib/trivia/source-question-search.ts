export type SourceQuestionSearchTaxonomyItem = {
  id: string
  name: string
}

export type SourceQuestionSearchTagAlias = {
  tag_id: string
  alias: string
}

const SEARCH_SYNONYM_GROUPS = [
  ['movie', 'movies', 'film', 'films', 'cinema', 'television', 'tv'],
  ['sport', 'sports'],
  ['music', 'song', 'songs', 'singer', 'singers', 'band', 'bands'],
  ['book', 'books', 'literature', 'novel', 'novels', 'author', 'authors'],
  ['art', 'arts'],
  ['food', 'foods', 'drink', 'drinks', 'cuisine'],
  ['technology', 'tech'],
  ['politics', 'political', 'government'],
  ['game', 'games', 'gaming', 'leisure'],
] as const

function normalizedSearchText(value: string) {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function searchVariants(normalizedSearch: string) {
  const variants = new Set([normalizedSearch])
  const words = normalizedSearch.split(' ')

  words.forEach((word, wordIndex) => {
    const synonymGroup = SEARCH_SYNONYM_GROUPS.find(group => group.some(synonym => synonym === word))
    synonymGroup?.forEach(synonym => {
      const variantWords = [...words]
      variantWords[wordIndex] = synonym
      variants.add(variantWords.join(' '))
    })
  })

  return [...variants]
}

function containsSearchPhrase(value: string, search: string) {
  const normalizedValue = ` ${normalizedSearchText(value)} `
  return normalizedValue.includes(` ${search} `)
}

export function sourceQuestionSearchOrFilter(
  search: string,
  categories: readonly SourceQuestionSearchTaxonomyItem[],
  tags: readonly SourceQuestionSearchTaxonomyItem[],
  tagAliases: readonly SourceQuestionSearchTagAlias[] = [],
) {
  const normalizedSearch = normalizedSearchText(search)
  if (!normalizedSearch) return null

  const variants = searchVariants(normalizedSearch)
  const matchingCategoryIds = categories
    .filter(category => variants.some(variant => containsSearchPhrase(category.name, variant)))
    .map(category => category.id)
  const matchingTagIds = new Set([
    ...tags
      .filter(tag => variants.some(variant => containsSearchPhrase(tag.name, variant)))
      .map(tag => tag.id),
    ...tagAliases
      .filter(tagAlias => variants.some(variant => containsSearchPhrase(tagAlias.alias, variant)))
      .map(tagAlias => tagAlias.tag_id),
  ])

  return [
    ...variants.map(variant => `search_text.wfts(english).${variant}`),
    matchingCategoryIds.length > 0 ? `category_ids.ov.{${matchingCategoryIds.join(',')}}` : null,
    matchingTagIds.size > 0 ? `tag_ids.ov.{${[...matchingTagIds].join(',')}}` : null,
  ].filter(Boolean).join(',')
}
