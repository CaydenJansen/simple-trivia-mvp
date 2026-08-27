export const TEAM_DORMANT_AFTER_MS = 5 * 60 * 1000
export const TEAM_PRESENCE_HEARTBEAT_MS = 45 * 1000

export function isTeamDormant(lastSeenAt: string | null | undefined, now = Date.now()) {
  if (!lastSeenAt) return true
  const seenAt = new Date(lastSeenAt).getTime()
  return !Number.isFinite(seenAt) || now - seenAt >= TEAM_DORMANT_AFTER_MS
}

