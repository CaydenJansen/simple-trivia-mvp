import { describe, expect, it } from 'vitest'
import { hostGameSettingsRecord, mergeHostGameSettings, persistentHostGameSettings } from './host-preferences'

describe('host game preferences', () => {
  it('rejects non-object preference values', () => {
    expect(hostGameSettingsRecord(null)).toEqual({})
    expect(hostGameSettingsRecord([])).toEqual({})
  })

  it('merges changed defaults without losing the others', () => {
    expect(mergeHostGameSettings(
      { leaderboard_visibility: 'round', team_approval_required: true },
      { leaderboard_visibility: 'question' },
    )).toEqual({ leaderboard_visibility: 'question', team_approval_required: true })
  })

  it('does not persist a live Auto-Run clock as a future-game default', () => {
    expect(persistentHostGameSettings({
      auto_run_mode: 'round',
      auto_run_clock: { seconds: 12 },
      leaderboard_visibility: 'round',
    })).toEqual({ auto_run_mode: 'round', leaderboard_visibility: 'round' })
  })
})
