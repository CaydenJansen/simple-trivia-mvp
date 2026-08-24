import { describe, expect, it } from 'vitest'

import { draggedItemCentreY, insertionIndexWithHysteresis, moveKeyToIndex, reorderKeys } from './builder-order'

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

describe('quiz builder live drag placement', () => {
  it('moves a key to an insertion index after removing it from the list', () => {
    expect(moveKeyToIndex(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveKeyToIndex(['a', 'b', 'c', 'd'], 'd', 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('clamps out-of-range indexes and ignores missing keys', () => {
    expect(moveKeyToIndex(['a', 'b'], 'a', 99)).toEqual(['b', 'a'])
    expect(moveKeyToIndex(['a', 'b'], 'b', -1)).toEqual(['b', 'a'])
    expect(moveKeyToIndex(['a', 'b'], 'missing', 1)).toEqual(['a', 'b'])
  })

  it('keeps the current slot while the pointer is inside a midpoint dead zone', () => {
    const centres = [100, 200, 300]
    expect(insertionIndexWithHysteresis(centres, 1, 191)).toBe(1)
    expect(insertionIndexWithHysteresis(centres, 1, 209)).toBe(1)
    expect(insertionIndexWithHysteresis(centres, 1, 211)).toBe(2)
    expect(insertionIndexWithHysteresis(centres, 2, 189)).toBe(1)
  })

  it('can cross several slots in one pointer update', () => {
    expect(insertionIndexWithHysteresis([100, 200, 300], 0, 400)).toBe(3)
    expect(insertionIndexWithHysteresis([100, 200, 300], 3, 0)).toBe(0)
  })

  it('uses the dragged card centre even when its handle is near the top', () => {
    expect(draggedItemCentreY(200, 100, 220, 290)).toBe(320)
  })
})
