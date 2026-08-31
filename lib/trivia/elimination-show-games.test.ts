import { describe, expect, it } from 'vitest'
import { autoBuildShowGameTypes, eliminationShowGameState, isEliminationShowGame, showGameInstructions } from './elimination-show-games'

describe('elimination show games', () => {
  it('recognises only multi-round elimination games', () => {
    expect(isEliminationShowGame('heads-or-tails')).toBe(true)
    expect(isEliminationShowGame('dodge-the-rock')).toBe(true)
    expect(isEliminationShowGame('scissors-paper-rock')).toBe(true)
    expect(isEliminationShowGame('spin-the-wheel')).toBe(false)
    expect(isEliminationShowGame('audience-question')).toBe(false)
    expect(isEliminationShowGame('big-balloon')).toBe(false)
    expect(isEliminationShowGame('steal-the-treasure')).toBe(false)
    expect(isEliminationShowGame('in-show-tiebreaker')).toBe(false)
  })

  it('parses safe defaults and clamps dodge lanes', () => {
    expect(eliminationShowGameState({ positions: { a: 7 }, round_phase: 'reveal', round_number: 2, round_matchups: [{ team_a: 'a', team_b: 'b' }], round_bye_team_id: 'c' })).toMatchObject({
      roundPhase: 'reveal',
      roundNumber: 2,
      positions: { a: 2 },
      matchups: [{ teamAId: 'a', teamBId: 'b' }],
      byeTeamId: 'c',
    })
  })

  it('explains that elimination games continue across rounds', () => {
    expect(showGameInstructions('heads-or-tails')).toContain('until one team remains')
    expect(showGameInstructions('dodge-the-rock')).toContain('last one standing')
    expect(showGameInstructions('scissors-paper-rock')).toContain('both teams advance on a draw')
  })

  it('describes Audience Question as a host-picked interaction', () => {
    expect(showGameInstructions('audience-question')).toContain('Pick your favourite response')
    expect(showGameInstructions('big-balloon')).toContain('biggest balloon')
    expect(showGameInstructions('steal-the-treasure')).toContain('bank')
    expect(showGameInstructions('in-show-tiebreaker')).toContain('closest')
  })

  it('adds one random-chance game per requested round without auto-authoring Audience Questions', () => {
    expect(autoBuildShowGameTypes(4, () => 0.999)).toEqual(['dodge-the-rock', 'dodge-the-rock', 'dodge-the-rock', 'dodge-the-rock'])
    expect(autoBuildShowGameTypes(0)).toEqual([])
  })
})
