export function buildGameJoinUrl(origin: string, gameCode: string) {
  const url = new URL('/play', origin)
  url.searchParams.set('code', gameCode)
  return url.toString()
}

export function gameCodeFromSearch(search: string) {
  const code = new URLSearchParams(search).get('code')?.replace(/\D/g, '') ?? ''
  return /^\d{6}$/.test(code) ? code : null
}
