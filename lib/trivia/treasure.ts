export const TREASURE_WARMUP_MS = 500

export function treasureAccruedMs(startedAtMs: number, nowMs: number) {
  return Math.max(0, nowMs - startedAtMs - TREASURE_WARMUP_MS)
}
