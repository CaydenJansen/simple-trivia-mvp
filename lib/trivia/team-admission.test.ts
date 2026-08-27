import { describe, expect, it } from 'vitest'
import { teamAdmissionTransition, teamApprovalRequiredFromSettings } from './team-admission'

describe('team admission transitions', () => {
  it('auto-joins by default and only requires approval explicitly', () => {
    expect(teamApprovalRequiredFromSettings(null)).toBe(false)
    expect(teamApprovalRequiredFromSettings({})).toBe(false)
    expect(teamApprovalRequiredFromSettings({ team_approval_required: true })).toBe(true)
    expect(teamApprovalRequiredFromSettings({ team_approval_required: false })).toBe(false)
  })

  it('keeps a pending team outside the game while the lobby is joinable', () => {
    expect(teamAdmissionTransition({
      admission_status: 'pending',
      team_id: null,
      name: 'Quizteama Aguilera',
      game_status: 'lobby',
    })).toEqual({ kind: 'waiting' })
  })

  it('admits an approved team with its real game team ID', () => {
    expect(teamAdmissionTransition({
      admission_status: 'approved',
      team_id: 'team-123',
      name: 'Quizteama Aguilera',
      game_status: 'live',
    })).toEqual({ kind: 'approved', teamId: 'team-123', name: 'Quizteama Aguilera' })
  })

  it('keeps denial generic and separate from team creation', () => {
    expect(teamAdmissionTransition({
      admission_status: 'denied',
      team_id: null,
      name: 'Any submitted name',
      game_status: 'lobby',
    })).toEqual({ kind: 'denied' })
  })

  it('does not admit requests after the game has finished or disappeared', () => {
    expect(teamAdmissionTransition({
      admission_status: 'pending',
      team_id: null,
      name: 'Late team',
      game_status: 'finished',
    })).toEqual({ kind: 'game-ended' })
    expect(teamAdmissionTransition(null)).toEqual({ kind: 'game-ended' })
  })
})
