import { describe, expect, it } from 'vitest'
import {
  showGameRewardDescription,
  showGameRewardFromSettings,
  showGameRewardSettings,
  showGameWinnerDetail,
  showGameWinnerMessage,
} from './show-game-rewards'

describe('show-game rewards', () => {
  it('defaults legacy show games to one bonus point', () => {
    expect(showGameRewardFromSettings({})).toEqual({
      type: 'points', points: 1, description: '', winnerMessage: '',
    })
  })

  it('clamps point rewards to a safe range', () => {
    expect(showGameRewardFromSettings({ reward_type: 'points', reward_points: 500 }).points).toBe(100)
    expect(showGameRewardFromSettings({ reward_type: 'points', reward_points: 0 }).points).toBe(1)
  })

  it('describes and announces point rewards', () => {
    const reward = showGameRewardFromSettings({ reward_type: 'points', reward_points: 2 })
    expect(showGameRewardDescription(reward)).toBe('The winner of this game will win 2 bonus points.')
    expect(showGameWinnerMessage(reward)).toBe('You won! 2 bonus points have been added to your score.')
    expect(showGameWinnerDetail(reward)).toBe('2 bonus points have been added to your score.')
  })

  it('uses custom prize and winner copy', () => {
    const reward = showGameRewardFromSettings({
      reward_type: 'custom',
      reward_description: 'The winner will win a free jug of beer.',
      winner_message: 'You won! Head to the bar for your beer!',
    })
    expect(showGameRewardDescription(reward)).toBe('The winner will win a free jug of beer.')
    expect(showGameWinnerMessage(reward)).toBe('You won! Head to the bar for your beer!')
    expect(showGameWinnerDetail(reward)).toBe('Head to the bar for your beer!')
    expect(showGameRewardSettings(reward)).toMatchObject({ reward_type: 'custom', reward_points: 0 })
  })
})
