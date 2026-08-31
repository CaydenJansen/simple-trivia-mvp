import { describe, expect, it } from 'vitest'
import { TREASURE_WARMUP_MS, treasureAccruedMs } from './treasure'

describe('treasure warm-up', () => {
  it('awards nothing during the first half-second hold', () => {
    expect(treasureAccruedMs(1_000, 1_499)).toBe(0)
    expect(treasureAccruedMs(1_000, 1_000 + TREASURE_WARMUP_MS)).toBe(0)
  })

  it('starts accumulating after the warm-up completes', () => {
    expect(treasureAccruedMs(1_000, 1_501)).toBe(1)
    expect(treasureAccruedMs(1_000, 2_250)).toBe(750)
  })
})
