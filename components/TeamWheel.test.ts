import { describe, expect, it } from 'vitest'
import { shouldAnimateWheelLanding, wheelLandingFraction, wheelSpeedAtElapsed } from './TeamWheel'

describe('wheelLandingFraction', () => {
  it('is deterministic across host and player devices', () => {
    expect(wheelLandingFraction('game-1:started:team-2')).toBe(wheelLandingFraction('game-1:started:team-2'))
  })

  it('places the pointer at varied positions safely inside a slice', () => {
    const positions = ['one', 'two', 'three', 'four'].map(wheelLandingFraction)
    expect(new Set(positions).size).toBeGreaterThan(1)
    for (const position of positions) {
      expect(position).toBeGreaterThanOrEqual(0.04)
      expect(position).toBeLessThanOrEqual(0.96)
    }
  })
})

describe('wheelSpeedAtElapsed', () => {
  it('pauses, accelerates, then holds its fast cruising speed', () => {
    expect(wheelSpeedAtElapsed(999)).toBe(0)
    expect(wheelSpeedAtElapsed(1600)).toBeGreaterThan(0)
    expect(wheelSpeedAtElapsed(1600)).toBeLessThan(2.9)
    expect(wheelSpeedAtElapsed(2200)).toBe(2.9)
    expect(wheelSpeedAtElapsed(5000)).toBe(2.9)
  })
})

describe('shouldAnimateWheelLanding', () => {
  it('replays the landing after a refresh instead of exposing the result immediately', () => {
    expect(shouldAnimateWheelLanding(false, 'game:result', null)).toBe(true)
    expect(shouldAnimateWheelLanding(false, 'game:result', 'game:result')).toBe(false)
    expect(shouldAnimateWheelLanding(true, 'game:result', 'game:result')).toBe(true)
  })
})
