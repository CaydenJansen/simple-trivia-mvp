import { describe, expect, it } from 'vitest'
import { createSynchronizedClock } from './synchronized-clock'
import { speedClock, speedPointsAvailable } from './speed-scoring'

describe('A5 synchronized countdowns and E2 reopened speed scoring', () => {
  it('uses network midpoint and monotonic elapsed time, not the device wall clock', () => {
    let elapsed = 120
    const clock = createSynchronizedClock(() => elapsed)
    expect(clock.now()).toBeNull()
    clock.sample(1000000, 100, 120)
    expect(clock.now()).toBe(1000010)
    elapsed += 1000
    expect(clock.now()).toBe(1001010)
    clock.sample(NaN, 0, 0)
    expect(clock.now()).toBe(1001010)
  })
  it('keeps the original scoring start when the editing deadline is extended', () => {
    const clock = speedClock({ scoring_mode: 'speed', speed_clock: { key: 'speed-q-core', opened_at_ms: 0, deadline_ms: 90000, duration_seconds: 30 } })!
    expect(speedPointsAvailable((60000 - clock.opened_at_ms) / 1000, clock.duration_seconds)).toBe(50)
    expect(speedClock({ scoring_mode: 'speed', speed_clock: { key: 'q', deadline_ms: 90000, duration_seconds: 30 } })?.opened_at_ms).toBe(60000)
  })
})

