export function playersSeeCorrectnessPercentage(settings: unknown) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
  return (settings as Record<string, unknown>).show_correctness_percentage_to_players === true
}
