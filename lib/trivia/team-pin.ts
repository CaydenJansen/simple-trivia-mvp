export const TEAM_PIN_LENGTH = 4

export type TeamPinMode = 'none' | 'have' | 'create'

export function normalizeTeamPin(value: string) {
  return value.replace(/\D/g, '').slice(0, TEAM_PIN_LENGTH)
}

export function isValidTeamPin(value: string) {
  return new RegExp(`^\\d{${TEAM_PIN_LENGTH}}$`).test(value)
}

export function teamPinErrorMessage(message: string | undefined) {
  if (message?.includes('TEAM_PIN_NOT_FOUND')) {
    return 'We couldn’t match that team name and PIN. Check both and try again.'
  }

  if (message?.includes('TEAM_PIN_ALREADY_EXISTS')) {
    return 'That team name and PIN already exist. Choose “I already have a team PIN” instead.'
  }

  if (message?.includes('TEAM_ALREADY_JOINED')) {
    return 'That team has already joined this game.'
  }

  if (message?.includes('TEAM_PIN_INVALID')) {
    return `Enter a ${TEAM_PIN_LENGTH}-digit team PIN.`
  }

  return null
}
