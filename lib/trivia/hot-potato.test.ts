import { describe, expect, it } from 'vitest'
import { hotPotatoHeat, hotPotatoPending, hotPotatoPoints, hotPotatoState, staleHotPotatoSnapshot } from './hot-potato'
import { TEAM_DECISION_SHOW_GAME_TYPES, TEMPLATE_EDITOR_SHOW_GAME_TYPES, showGameInstructions, showGameLabel, showGameTeamRecommendation } from './elimination-show-games'

describe('Hot Potato display state', () => {
  it('displays whole-number hundreds without changing stored scores or rewards', () => {
    expect(hotPotatoPoints(0)).toBe(0)
    expect(hotPotatoPoints(1)).toBe(100)
    expect(hotPotatoPoints(3.6)).toBe(360)
    expect(hotPotatoPoints(3.61)).toBe(361)
    expect(hotPotatoPoints(3.62)).toBe(362)
    expect(hotPotatoPoints(8.1234)).toBe(812)
    expect(hotPotatoPoints(19.9)).toBe(1990)
    expect(hotPotatoPoints(-1)).toBe(0)
    expect(hotPotatoPoints(Number.NaN)).toBe(0)
  })
  const settings = { hot_potato: { sampled_at: '2026-10-01T00:00:00Z', teams: [{ id: 'a', name: 'A', banked: 2, pending: 4, bursts: 1 }], potatoes: [1, 2].map(id => ({ id: String(id), holder_id: 'a', born_at: '2026-10-01T00:00:00Z', received_at: '2026-10-01T00:00:00Z' })) } }
  it('is available in game and template selectors with clear banking rules', () => {
    expect(TEAM_DECISION_SHOW_GAME_TYPES).toContain('hot-potato')
    expect(TEMPLATE_EDITOR_SHOW_GAME_TYPES).toContain('hot-potato')
    expect(showGameLabel('hot-potato')).toBe('Hot Potato')
    expect(showGameInstructions('hot-potato')).toContain('last potato banks')
    expect(showGameTeamRecommendation('hot-potato')).toContain('One potato per 4 teams, rounded up')
  })
  it('projects multiple potatoes continuously but caps disconnected interpolation', () => {
    const state = hotPotatoState(settings), time = state.sampledAt
    expect(hotPotatoPending(state.teams[0], state, time + 500, time + 90000, false)).toBe(5)
    expect(hotPotatoPending(state.teams[0], state, time + 30000, time + 90000, false)).toBe(6)
    expect(hotPotatoPending(state.teams[0], state, time + 1000, time + 250, false)).toBe(4.5)
    expect(hotPotatoPending(state.teams[0], state, time + 1000, time + 90000, true)).toBe(0)
  })
  it('does not accrue points without holding a potato', () => {
    const state = hotPotatoState(settings)
    expect(hotPotatoPending({ ...state.teams[0], id: 'b' }, state, state.sampledAt + 500, state.sampledAt + 90000, false)).toBe(4)
  })
  it('handles missing state and malformed rows without crashing', () => {
    expect(hotPotatoState(null)).toEqual({ teams: [], potatoes: [], sampledAt: 0, revision: 0 })
    expect(hotPotatoState({ hot_potato: { teams: [null, { id: 1 }], potatoes: [false] } }).teams).toEqual([])
  })
  it('increases shaking with age without needing a secret explosion time', () => {
    const born = settings.hot_potato.sampled_at, time = Date.parse(born)
    expect(hotPotatoHeat(born, time - 10)).toBe(0)
    expect(hotPotatoHeat(born, time + 11000)).toBe(0.5)
    expect(hotPotatoHeat(born, time + 60000)).toBe(1)
  })
  it('rejects stale polls and cannot reopen a finished round', () => {
    const older = { id: 'game', game_type: 'hot-potato', status: 'open', settings }
    const newer = { ...older, settings: { hot_potato: { ...settings.hot_potato, sampled_at: '2026-10-01T00:00:01Z' } } }
    expect(staleHotPotatoSnapshot(newer, older)).toBe(true)
    expect(staleHotPotatoSnapshot(older, newer)).toBe(false)
    expect(staleHotPotatoSnapshot({ ...newer, status: 'exploded' }, older)).toBe(true)
    expect(staleHotPotatoSnapshot(older, { ...newer, id: 'next-game' })).toBe(false)
    expect(staleHotPotatoSnapshot({ ...older, settings: { hot_potato: { ...settings.hot_potato, revision: 2 } } }, older)).toBe(true)
  })
})
