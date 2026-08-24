export function playersSeeScoresFromSettings(settings: unknown) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return true
  return (settings as Record<string, unknown>).scores_visible_to_players !== false
}
