import { describe, expect, it } from 'vitest'

import { answerCandidates, answerVariants } from './answer-variants'

describe('legacy answer variants', () => {
  it('separates slash-delimited alternatives from display copy', () => {
    expect(answerVariants('Harley Quinn/ Harleen Quinzel')).toEqual({
      primary: 'Harley Quinn',
      accepted: ['Harleen Quinzel', 'Harley Quinn/ Harleen Quinzel'],
    })
  })

  it('removes pronunciation and explanatory parentheses from the required answer', () => {
    expect(answerVariants('Spectre (spect-tah)').primary).toBe('Spectre')
    expect(answerVariants('United Kingdom /Britain (they were filled with hops)')).toMatchObject({
      primary: 'United Kingdom',
      accepted: expect.arrayContaining(['Britain']),
    })
  })

  it('extracts explicit accepted answers from parenthetical notes', () => {
    expect(answerCandidates('Ottoman (we’ll also accept Persian rug)')).toEqual(expect.arrayContaining([
      'Ottoman',
      'Persian rug',
    ]))
    expect(answerCandidates('Lady Gaga (we’ll also accept her real name, Stefani Joanne Angelina Germanotta)')).toEqual(expect.arrayContaining([
      'Lady Gaga',
      'Stefani Joanne Angelina Germanotta',
    ]))
    expect(answerCandidates('Blue whale (or sulphur-bottom)')).toEqual(expect.arrayContaining([
      'Blue whale',
      'sulphur-bottom',
    ]))
  })
})
