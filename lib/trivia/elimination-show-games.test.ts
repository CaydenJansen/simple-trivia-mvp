import { describe, expect, it } from 'vitest'
import { eliminationShowGameState, isEliminationShowGame, showGameInstructions } from './elimination-show-games'

describe('elimination show games', () => {
  it('recognises only multi-round elimination games', () => {
    expect(isEliminationShowGame('heads-or-tails')).toBe(true)
    expect(isEliminationShowGame('dodge-the-rock')).toBe(true)
    expect(isEliminationShowGame('spin-the-wheel')).toBe(false)
  })

  it('parses safe defaults and clamps dodge lanes', () => {
    expect(eliminationShowGameState({ positions: { a: 7 }, round_phase: 'reveal', round_number: 2 })).toMatchObject({
      roundPhase: 'reveal',
      roundNumber: 2,
      positions: { a: 2 },
    })
  })

  it('explains that elimination games continue across rounds', () => {
    expect(showGameInstructions('heads-or-tails')).toContain('until one team remains')
    expect(showGameInstructions('dodge-the-rock')).toContain('last one standing')
  })
})
