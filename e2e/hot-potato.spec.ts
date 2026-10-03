import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, host = false) {
  const userId = '00000000-0000-4000-8000-000000000001'
  if (host) {
    await page.addInitScript(userId => {
      const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: userId, exp: 4102444800, role: 'authenticated' }))}.test`
      localStorage.setItem('sb-fubensgmepniquokbmmw-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: userId, email: 'host@example.test', aud: 'authenticated', role: 'authenticated' } }))
      localStorage.setItem('simple-trivia-host-game-id', 'potato-game')
    }, userId)
    await page.route('**/auth/v1/**', route => route.fulfill({ json: { id: userId, email: 'host@example.test', aud: 'authenticated', role: 'authenticated' } }))
  }
  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'potato-game')
    localStorage.setItem('simple-trivia-team-id', 'a')
    localStorage.setItem('simple-trivia-team-name', 'Team A')
    localStorage.setItem('simple-trivia-join-request-id', 'request-a')
    localStorage.setItem('simple-trivia-join-request-token', 'token-a')
  })
  const born = new Date(Date.now() - 4000).toISOString()
  const teams = ['a', 'b', 'c'].map(id => ({ id, name: `Team ${id.toUpperCase()}`, banked: 0, pending: id === 'a' ? 8 : 0, bursts: 0 }))
  const game = { id: 'potato-round', show_game_key: 'potato', round_number: 1, game_type: 'hot-potato', title: 'Hot Potato', status: 'open', started_at: born, explode_at: new Date(Date.now() + 90000).toISOString(), winner_team_id: null as string | null, settings: { reward_type: 'points', reward_points: 1, eligible_team_ids: ['a', 'b', 'c'], hot_potato: { teams, sampled_at: new Date().toISOString(), potatoes: [1, 2].map(id => ({ id: `p${id}`, holder_id: 'a', born_at: born, received_at: born })) } } }
  const passes: Record<string, string>[] = []
  let fail = false
  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url()), name = url.pathname.split('/').pop()
    const json = (value: unknown) => route.fulfill({ json: value })
    if (name === 'get_server_epoch_ms') return json(Date.now())
    if (name === 'quizzes') {
      const quiz = { id: 'potato-quiz', owner_id: userId, title: 'Potato fixture', status: 'ready', round_count: 1, question_count: 0 }
      return json(url.searchParams.has('id') ? quiz : [quiz])
    }
    if (name === 'game_show_games') return json([{ ...game, item_position: 1, round_title: 'Potatoes' }])
    if (name === 'start_hot_potato') { game.status = 'open'; return json(game) }
    if (name === 'advance_hot_potato') { game.settings.hot_potato.sampled_at = new Date().toISOString(); return json(game) }
    if (name === 'get_team_join_request') return json({ admission_status: 'approved', team_id: 'a', name: 'Team A', game_status: 'live' })
    if (name === 'games') return json({ id: 'potato-game', quiz_id: 'potato-quiz', code: '123456', status: 'live', current_screen: 'show-game', current_show_game_key: 'potato', current_question_key: null, settings: {} })
    if (name === 'get_owned_player_show_game') { game.settings.hot_potato.sampled_at = new Date().toISOString(); return json(game) }
    if (name === 'teams') return json(url.searchParams.has('id') ? { id: 'a', name: 'Team A', game_id: 'potato-game', score: 0 } : teams.map(team => ({ ...team, score: 0, last_seen_at: new Date().toISOString() })))
    if (name === 'pass_hot_potato') {
      const body = route.request().postDataJSON(); passes.push(body)
      if (fail) { fail = false; return route.fulfill({ status: 503, json: { message: 'Temporary failure' } }) }
      const potato = game.settings.hot_potato.potatoes.find(item => item.id === body.p_potato_id)!
      potato.holder_id = body.p_recipient_id
      if (!game.settings.hot_potato.potatoes.some(item => item.holder_id === 'a')) { teams[0].banked = teams[0].pending; teams[0].pending = 0 }
      return json({ game, outcome: 'passed' })
    }
    return json([])
  })
  return { game, passes, failNext: () => { fail = true } }
}

test('holding several potatoes only banks after the final pass and survives refresh', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const mock = await fixture(page)
  await page.goto('/play')
  await expect(page.getByRole('button', { name: 'Pass to Team B' })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('button', { name: 'CUT THE WIRE' })).toHaveCount(0)
  await expect(page.getByText('2 potatoes · +200 points/second. Pass them all to bank.')).toBeVisible()
  await page.screenshot({ path: info.outputPath('hot-potato-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Pass to Team B' }).click()
  expect(mock.game.settings.hot_potato.teams[0].banked).toBe(0)
  await expect(page.getByText('1 potato · +100 points/second. Pass them all to bank.')).toBeVisible()
  await page.getByRole('button', { name: 'Pass to Team C' }).click()
  await expect(page.getByText('No potatoes right now. Watch who’s holding them!')).toBeVisible()
  expect(mock.game.settings.hot_potato.teams[0].banked).toBe(8)
  await expect(page.getByText('800 banked · 0 pending')).toBeVisible()
  expect(mock.passes[0]).toMatchObject({ p_request_id: 'request-a', p_request_token: 'token-a', p_potato_id: 'p1', p_recipient_id: 'b' })
  await page.reload()
  await expect(page.getByText('No potatoes right now. Watch who’s holding them!')).toBeVisible()
  await expect(page.getByText('800 banked · 0 pending')).toBeVisible()
})

test('failed pass retries use the same operation id and controls recover', async ({ page }) => {
  const mock = await fixture(page); mock.failNext()
  await page.goto('/play')
  await page.getByRole('button', { name: 'Pass to Team B' }).click()
  await expect(page.getByText(/Pass not confirmed/)).toBeVisible()
  await page.getByRole('button', { name: 'Pass to Team B' }).click()
  await expect(page.getByText(/Passed! Your points bank/)).toBeVisible()
  expect(mock.passes).toHaveLength(2)
  expect(mock.passes[0].p_operation_id).toBe(mock.passes[1].p_operation_id)
})

test('points animate with individual digits and banked scores retain that precision', async ({ page }) => {
  const mock = await fixture(page)
  mock.game.settings.hot_potato.teams[0].banked = 3.61
  await page.goto('/play')
  await expect(page.getByText('Banked · safe').locator('..').getByText('361', { exact: true })).toBeVisible()
  const counter = page.getByText('Pending · at risk').locator('..').locator('p').last()
  const values = await counter.evaluate(element => new Promise<string[]>(resolve => {
    const samples: string[] = []
    const observer = new MutationObserver(() => samples.push(element.textContent ?? ''))
    observer.observe(element, { childList: true, characterData: true, subtree: true })
    setTimeout(() => { observer.disconnect(); resolve(samples) }, 700)
  }))
  expect(values.length).toBeGreaterThan(10)
  expect(values.every(value => /^\d+$/.test(value))).toBe(true)
  expect(values.some(value => Number(value) % 10 !== 0)).toBe(true)
  mock.game.status = 'exploded'; mock.game.winner_team_id = 'a'; mock.game.settings.hot_potato.potatoes = []
  await expect(page.getByText('361 banked · 0 pending')).toBeVisible()
})

test('potatoes, explosions and final scores update without player taps', async ({ page }) => {
  const mock = await fixture(page)
  await page.goto('/play')
  await expect(page.getByLabel('Team A holds 2 potatoes')).toBeVisible()
  mock.game.settings.hot_potato.potatoes[0].holder_id = 'b'
  mock.game.settings.hot_potato.teams[0].bursts = 1
  mock.game.settings.hot_potato.teams[0].pending = 0
  await expect(page.getByLabel('Team B holds 1 potatoes')).toBeVisible()
  await expect(page.getByText(/1 explosion · pending points were lost/)).toBeVisible()
  mock.game.status = 'exploded'; mock.game.winner_team_id = 'a'; mock.game.settings.hot_potato.potatoes = []
  await expect(page.getByRole('heading', { name: 'You won!', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Pass to/ })).toHaveCount(0)
})

test('team search retains the chosen potato during passive updates', async ({ page }) => {
  const mock = await fixture(page)
  await page.goto('/play')
  await page.getByRole('button', { name: 'Select potato 2' }).click()
  await page.getByPlaceholder('Search team names').fill('Team C')
  await page.waitForTimeout(1200)
  await expect(page.getByRole('button', { name: 'Pass to Team B' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Pass to Team C' }).click()
  expect(mock.passes[0]).toMatchObject({ p_potato_id: 'p2', p_recipient_id: 'c' })
})

test('host starts Hot Potato and sees passive results before Continue unlocks', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Host console is checked in desktop profiles')
  const mock = await fixture(page, true); mock.game.status = 'ready'
  await page.goto('/host')
  await page.getByRole('button', { name: 'Start Hot Potato →' }).click()
  await expect(page.getByText('Hot Potato scores · not quiz points')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Potatoes in play…' })).toBeDisabled()
  mock.game.status = 'exploded'; mock.game.winner_team_id = 'a'; mock.game.settings.hot_potato.potatoes = []
  await expect(page.getByText('Final Hot Potato scores')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue →', exact: true })).toBeEnabled()
})
