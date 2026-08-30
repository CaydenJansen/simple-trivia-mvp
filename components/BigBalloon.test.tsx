import { describe, expect, it } from 'vitest'
import { balloonComparisonSizes, balloonProgress, balloonShakeStyle, type BigBalloonEntry } from './BigBalloon'

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

  it('ramps shaking smoothly from halfway without the old threshold jumps', () => {
    expect(balloonShakeStyle(0.49)).toBeUndefined()
    const halfway = balloonShakeStyle(0.5) as Record<string, string>
    const threeQuarters = balloonShakeStyle(0.75) as Record<string, string>
    const full = balloonShakeStyle(1) as Record<string, string>
    expect(parseFloat(halfway['--balloon-shake-x'])).toBeLessThan(parseFloat(threeQuarters['--balloon-shake-x']))
    expect(parseFloat(threeQuarters['--balloon-shake-x'])).toBeLessThan(parseFloat(full['--balloon-shake-x']))
    expect(parseFloat(full['--balloon-shake-x'])).toBeLessThanOrEqual(8.5)
  })
})
