import { describe, expect, it } from 'vitest'
import { ARCHIVED_SHOW_GAME_TYPES, ELIMINATION_SHOW_GAME_TYPES, HOST_PICKED_SHOW_GAME_TYPES, IMMEDIATE_WINNER_SHOW_GAME_TYPES, RANDOM_CHANCE_SHOW_GAME_TYPES, TEMPLATE_EDITOR_SHOW_GAME_TYPES, TIE_RESOLUTION_SHOW_GAME_TYPES, autoBuildShowGameTypes, eliminationShowGameState, isArchivedShowGame, isEliminationShowGame, isTiebreakerLibraryShowGame, showGameInstructions } from './elimination-show-games'

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

  it('keeps every Tiebreaker Library-backed show-game surface in sync', () => {
    expect(isTiebreakerLibraryShowGame('in-show-tiebreaker')).toBe(true)
    expect(isTiebreakerLibraryShowGame('tiebreaker-style-question')).toBe(true)
    expect(isTiebreakerLibraryShowGame('audience-question')).toBe(false)
    expect(isTiebreakerLibraryShowGame('spin-the-wheel')).toBe(false)
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
    expect(showGameInstructions('scissors-paper-rock')).toContain('ten-second timer')
    expect(showGameInstructions('scissors-paper-rock')).toContain('draws send both teams through')
    expect(showGameInstructions('scissors-paper-rock')).not.toContain('unpaired')
  })

  it('describes Audience Question as a host-picked interaction', () => {
    expect(showGameInstructions('audience-question')).toContain('favourite submitted answer')
    expect(showGameInstructions('audience-question')).not.toContain('numerical')
    expect(showGameInstructions('tiebreaker-style-question')).toContain('closest answer wins')
    expect(showGameInstructions('big-balloon')).toContain('biggest balloon')
    expect(showGameInstructions('steal-the-treasure')).toContain('bank')
    expect(showGameInstructions('in-show-tiebreaker')).toContain('closest')
  })

  it('adds one random-chance game per requested round without auto-authoring Audience Questions', () => {
    expect(autoBuildShowGameTypes(4, () => 0.999)).toEqual(['dodge-the-rock', 'dodge-the-rock', 'dodge-the-rock', 'dodge-the-rock'])
    expect(autoBuildShowGameTypes(0)).toEqual([])
  })

  it('keeps archived games playable but out of automatic generation', () => {
    expect(ARCHIVED_SHOW_GAME_TYPES).toEqual(['beat-the-bomb', 'big-balloon', 'steal-the-treasure'])
    expect(isArchivedShowGame('beat-the-bomb')).toBe(true)
    expect(isArchivedShowGame('spin-the-wheel')).toBe(false)
    const authoringSurfaces = [
      IMMEDIATE_WINNER_SHOW_GAME_TYPES,
      ELIMINATION_SHOW_GAME_TYPES,
      HOST_PICKED_SHOW_GAME_TYPES,
      TEMPLATE_EDITOR_SHOW_GAME_TYPES,
      TIE_RESOLUTION_SHOW_GAME_TYPES,
      RANDOM_CHANCE_SHOW_GAME_TYPES,
    ].flat()
    ARCHIVED_SHOW_GAME_TYPES.forEach(type => expect(authoringSurfaces).not.toContain(type))
  })
})
