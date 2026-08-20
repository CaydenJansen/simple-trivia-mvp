import { describe, expect, it } from 'vitest'
import { calculatePrizeAwards, prizeAwardsFromJson } from './prizes'

const settings = {
  top_prizes: [
    { enabled: true, msg: 'Winner voucher' },
    { enabled: false, msg: 'Disabled' },
    { enabled: true, msg: 'Third-place treat' },
  ],
  bottom_prizes: [
    { enabled: true, msg: 'Last-place snack' },
    { enabled: true, msg: 'Second-last surprise' },
    { enabled: false, msg: '' },
  ],
}

describe('prize placement semantics', () => {
  it('awards enabled top and bottom placements using displayed leaderboard order', () => {
    const awards = calculatePrizeAwards(settings, ['a', 'b', 'c', 'd', 'e'])

    expect(awards.get('a')).toEqual([{ placement: '1st', message: 'Winner voucher' }])
    expect(awards.get('c')).toEqual([{ placement: '3rd', message: 'Third-place treat' }])
    expect(awards.get('e')).toEqual([{ placement: 'Last', message: 'Last-place snack' }])
    expect(awards.get('d')).toEqual([{ placement: '2nd Last', message: 'Second-last surprise' }])
    expect(awards.has('b')).toBe(false)
  })

  it('allows one team to receive distinct configured placements in a small game', () => {
    const awards = calculatePrizeAwards(settings, ['a', 'b'])

    expect(awards.get('a')).toEqual([
      { placement: '1st', message: 'Winner voucher' },
      { placement: '2nd Last', message: 'Second-last surprise' },
    ])
    expect(awards.get('b')).toEqual([{ placement: 'Last', message: 'Last-place snack' }])
  })

  it('ignores disabled, blank, and malformed prize settings', () => {
    expect(calculatePrizeAwards({ top_prizes: [{ enabled: true, msg: '  ' }] }, ['a']).size).toBe(0)
    expect(calculatePrizeAwards(null, ['a']).size).toBe(0)
  })

  it('parses only usable stored prize awards', () => {
    expect(prizeAwardsFromJson([
      { placement: '1st', message: '  Winner voucher  ' },
      { placement: 'Fourth', message: 'Nope' },
      { placement: 'Last', message: '' },
      null,
    ])).toEqual([{ placement: '1st', message: 'Winner voucher' }])
  })
})
