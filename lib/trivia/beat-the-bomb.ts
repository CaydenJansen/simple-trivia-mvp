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

export function secondsBeforeBombExplosion(cutAt: string | null | undefined, explosionAt: string | null | undefined) {
  const cut = Date.parse(cutAt ?? '')
  const explosion = Date.parse(explosionAt ?? '')
  if (!Number.isFinite(cut) || !Number.isFinite(explosion)) return null
  return Math.max(0, Math.round((explosion - cut) / 1000))
}

export function bombCutTimingSentence(subject: 'You' | 'The winner', seconds: number) {
  if (seconds === 0) return `${subject} cut the wire at the last possible moment.`
  return `${subject} cut the wire ${seconds} second${seconds === 1 ? '' : 's'} before the bomb exploded.`
}
