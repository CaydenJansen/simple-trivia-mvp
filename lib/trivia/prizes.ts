export type PrizePlacement = string

export type PrizeAward = {
  placement: PrizePlacement
  message: string
}

export type PrizeSetting = {
  enabled: boolean
  msg: string
}

export type CustomPrizeSetting = PrizeSetting & {
  position: number
  missingBehavior: 'closest' | 'ignore'
}

export function ordinalPrizePlacement(position: number) {
  const whole = Math.max(1, Math.trunc(position))
  const mod100 = whole % 100
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : whole % 10 === 1 ? 'st' : whole % 10 === 2 ? 'nd' : whole % 10 === 3 ? 'rd' : 'th'
  return `${whole}${suffix}`
}

const TOP_PLACEMENTS: PrizePlacement[] = ['1st', '2nd', '3rd']
const BOTTOM_PLACEMENTS: PrizePlacement[] = ['Last', '2nd Last', '3rd Last']

export function prizeSettings(value: unknown): PrizeSetting[] {
  if (!Array.isArray(value)) return []

  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { enabled: false, msg: '' }
    const setting = item as Record<string, unknown>
    return {
      enabled: setting.enabled === true,
      msg: typeof setting.msg === 'string' ? setting.msg.trim() : '',
    }
  })
}

export function customPrizeSettings(value: unknown): CustomPrizeSetting[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const setting = item as Record<string, unknown>
    const position = Math.trunc(Number(setting.position))
    if (!Number.isFinite(position) || position < 1) return []
    return [{
      position,
      enabled: setting.enabled === true,
      msg: typeof setting.msg === 'string' ? setting.msg.trim() : '',
      missingBehavior: setting.missing_behavior === 'closest' || setting.missingBehavior === 'closest' ? 'closest' as const : 'ignore' as const,
    }]
  })
}

export function calculatePrizeAwards(
  settings: unknown,
  rankedTeamIds: string[],
): Map<string, PrizeAward[]> {
  const awards = new Map<string, PrizeAward[]>()
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return awards

  const gameSettings = settings as Record<string, unknown>
  const top = prizeSettings(gameSettings.top_prizes)
  const bottom = prizeSettings(gameSettings.bottom_prizes)
  const custom = customPrizeSettings(gameSettings.other_prizes)

  function award(teamId: string | undefined, placement: PrizePlacement, setting: PrizeSetting | undefined) {
    if (!teamId || !setting?.enabled || !setting.msg) return
    awards.set(teamId, [...(awards.get(teamId) ?? []), { placement, message: setting.msg }])
  }

  TOP_PLACEMENTS.forEach((placement, index) => award(rankedTeamIds[index], placement, top[index]))
  BOTTOM_PLACEMENTS.forEach((placement, index) => award(rankedTeamIds.at(-(index + 1)), placement, bottom[index]))
  custom.forEach(setting => {
    const targetIndex = setting.position <= rankedTeamIds.length
      ? setting.position - 1
      : setting.missingBehavior === 'closest' ? rankedTeamIds.length - 1 : -1
    if (targetIndex >= 0) award(rankedTeamIds[targetIndex], ordinalPrizePlacement(setting.position), setting)
  })

  return awards
}

export function prizeAwardsFromJson(value: unknown): PrizeAward[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const award = item as Record<string, unknown>
    if (typeof award.placement !== 'string' || !award.placement.trim()) return []
    const placement = award.placement.trim()
    if (!TOP_PLACEMENTS.concat(BOTTOM_PLACEMENTS).includes(placement) && !new RegExp('^\\d+(?:st|nd|rd|th)$', 'i').test(placement)) return []
    if (typeof award.message !== 'string' || !award.message.trim()) return []
    return [{ placement, message: award.message.trim() }]
  })
}
