import { describe, expect, it } from 'vitest'

import { reorderKeys } from './builder-order'

describe('quiz builder ordering', () => {
  it('moves an item before a later item', () => {
    expect(reorderKeys(['a', 'b', 'c', 'd'], 'a', 'c', 'before')).toEqual(['b', 'a', 'c', 'd'])
  })

  it('moves an item after a later item', () => {
    expect(reorderKeys(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item before an earlier item', () => {
    expect(reorderKeys(['a', 'b', 'c', 'd'], 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves an item after an earlier item', () => {
    expect(reorderKeys(['a', 'b', 'c', 'd'], 'd', 'b', 'after')).toEqual(['a', 'b', 'd', 'c'])
  })

  it('does nothing for a missing or identical target', () => {
    expect(reorderKeys(['a', 'b'], 'a', 'missing', 'before')).toEqual(['a', 'b'])
    expect(reorderKeys(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b'])
  })
})
