export const GAME_CODE_LENGTH = 6

export function normalizeGameCode(value: string) {
  return value.replace(/\D/g, '').slice(0, GAME_CODE_LENGTH)
}

export function buildGameJoinUrl(origin: string, gameCode: string) {
  const url = new URL('/play', origin)
  url.searchParams.set('code', gameCode)
  return url.toString()
}

export function gameCodeFromSearch(search: string) {
  const code = new URLSearchParams(search).get('code')?.replace(/\D/g, '') ?? ''
  return new RegExp(`^\\d{${GAME_CODE_LENGTH}}$`).test(code) ? code : null
}

export function withGameCodeInUrl(currentUrl: string, gameCode: string) {
  const url = new URL(currentUrl)
  url.searchParams.set('code', normalizeGameCode(gameCode))
  return url.toString()
}
