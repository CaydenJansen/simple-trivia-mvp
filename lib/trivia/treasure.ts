export const TREASURE_WARMUP_MS = 300

export function treasureAccruedMs(startedAtMs: number, nowMs: number) {
  return Math.max(0, nowMs - startedAtMs - TREASURE_WARMUP_MS)
}
