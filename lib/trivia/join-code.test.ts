import { describe, expect, it } from 'vitest'
import { buildGameJoinUrl, gameCodeFromSearch, normalizeGameCode } from './join-code'

describe('game join links', () => {
  it('builds a player link containing the game code', () => {
    expect(buildGameJoinUrl('https://simple-trivia.example', '307117'))
      .toBe('https://simple-trivia.example/play?code=307117')
  })

  it('reads a six-digit game code from a join link', () => {
    expect(gameCodeFromSearch('?code=307117')).toBe('307117')
  })

  it('normalizes pasted game codes before applying the length limit', () => {
    expect(normalizeGameCode('ab12 34-56')).toBe('123456')
    expect(normalizeGameCode('123456789')).toBe('123456')
  })

  it('rejects missing or malformed game codes', () => {
    expect(gameCodeFromSearch('')).toBeNull()
    expect(gameCodeFromSearch('?code=12345')).toBeNull()
    expect(gameCodeFromSearch('?code=1234567')).toBeNull()
    expect(gameCodeFromSearch('?code=abcdef')).toBeNull()
  })
})
