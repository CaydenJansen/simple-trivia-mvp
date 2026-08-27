export type PrizePlacement = '1st' | '2nd' | '3rd' | 'Last' | '2nd Last' | '3rd Last'

export type PrizeAward = {
  placement: PrizePlacement
  message: string
}

export type PrizeSetting = {
  enabled: boolean
  msg: string
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

export function calculatePrizeAwards(
  settings: unknown,
  rankedTeamIds: string[],
): Map<string, PrizeAward[]> {
  const awards = new Map<string, PrizeAward[]>()
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return awards

  const gameSettings = settings as Record<string, unknown>
  const top = prizeSettings(gameSettings.top_prizes)
  const bottom = prizeSettings(gameSettings.bottom_prizes)

  function award(teamId: string | undefined, placement: PrizePlacement, setting: PrizeSetting | undefined) {
    if (!teamId || !setting?.enabled || !setting.msg) return
    awards.set(teamId, [...(awards.get(teamId) ?? []), { placement, message: setting.msg }])
  }

  TOP_PLACEMENTS.forEach((placement, index) => award(rankedTeamIds[index], placement, top[index]))
  BOTTOM_PLACEMENTS.forEach((placement, index) => award(rankedTeamIds.at(-(index + 1)), placement, bottom[index]))

  return awards
}

export function prizeAwardsFromJson(value: unknown): PrizeAward[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const award = item as Record<string, unknown>
    if (!TOP_PLACEMENTS.concat(BOTTOM_PLACEMENTS).includes(award.placement as PrizePlacement)) return []
    if (typeof award.message !== 'string' || !award.message.trim()) return []
    return [{ placement: award.placement as PrizePlacement, message: award.message.trim() }]
  })
}
