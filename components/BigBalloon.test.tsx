import { describe, expect, it } from 'vitest'
import { balloonComparisonSizes, balloonProgress, type BigBalloonEntry } from './BigBalloon'

describe('balloonProgress', () => {
  it('maps server units to a bounded visual size', () => {
    expect(balloonProgress(-1)).toBe(0)
    expect(balloonProgress(5_000_000)).toBe(0.5)
    expect(balloonProgress(50_000_000)).toBe(1)
  })

  it('makes an imperceptibly different winning balloon at least five percent larger in the result comparison', () => {
    const own: BigBalloonEntry = { team_id: 'one', size_units: 7_000_000, status: 'locked' }
    const winner: BigBalloonEntry = { team_id: 'two', size_units: 7_000_001, status: 'locked' }
    const sizes = balloonComparisonSizes(own, winner)
    expect(sizes.winner).toBeGreaterThanOrEqual(sizes.own * 1.05)
  })
})
