export const BEAT_THE_BOMB_MIN_SECONDS = 10
export const BEAT_THE_BOMB_MAX_SECONDS = 30

export function shouldResolveBeatTheBomb(input: {
  pressCount: number
  teamCount: number
  nowMs: number
  explodeAtMs: number
}) {
  if (input.pressCount < 1) return false
  return input.pressCount >= input.teamCount || input.nowMs >= input.explodeAtMs
}

export function beatTheBombWinner<T extends { teamId: string; pressedAtMs: number }>(presses: T[]) {
  return [...presses].sort((a, b) => b.pressedAtMs - a.pressedAtMs)[0]?.teamId ?? null
}
