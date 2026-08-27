import { describe, expect, it } from 'vitest'
import { wheelLandingFraction } from './TeamWheel'

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
