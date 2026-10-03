import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, restore = false) {
  const user = '00000000-0000-4000-8000-000000000001'
  await page.addInitScript(({ user, restore }) => {
    const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: user, exp: 4102444800, role: 'authenticated' }))}.test`
    localStorage.setItem('sb-fubensgmepniquokbmmw-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: user, email: 'host@example.test', aud: 'authenticated', role: 'authenticated' } }))
    if (restore) localStorage.setItem('simple-trivia-host-game-id', 'practice-game')
  }, { user, restore })
  await page.route('**/auth/v1/**', route => route.fulfill({ json: { id: user, email: 'host@example.test', aud: 'authenticated', role: 'authenticated' } }))
  const quiz = { id: 'quiz', owner_id: user, title: 'Practice Quiz', status: 'ready', round_count: 1, question_count: 1, show_game_count: 1, updated_at: new Date().toISOString() }
  const teams = [0, 1, 2].map(i => ({ id: `team-${i}`, game_id: 'practice-game', name: `Practice Team ${i + 1}`, score: 0, last_seen_at: new Date(Date.now() - [0, 120000, 360000][i]).toISOString(), simulated: true, submitted: i === 0 }))
  const health = { game_id: 'practice-game', code: '123456', status: 'lobby', practice: true, paused: false, server_time: new Date().toISOString(), screen: 'single-answer', answer_phase: 'open', teams }
  const creates: Record<string, unknown>[] = [], controls: string[] = [], preferences: unknown[] = []
  let failHealth = false, ticks = 0
  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url()), name = url.pathname.split('/').pop()
    const json = (value: unknown) => route.fulfill({ json: value })
    if (name === 'quizzes') return json(url.searchParams.has('id') ? quiz : [quiz])
    if (name === 'get_host_game_count') return json(0)
    if (name === 'host_preferences') {
      if (route.request().method() === 'POST') preferences.push(route.request().postDataJSON())
      return json({ game_settings: {} })
    }
    if (name === 'games') return json({ id: 'practice-game', quiz_id: 'quiz', code: '123456', title: quiz.title, status: 'lobby', current_screen: 'lobby', settings: { practice_mode: true } })
    if (name === 'teams') return json(teams)
    if (name === 'create_practice_game') { creates.push(route.request().postDataJSON()); return json({ game_id: 'practice-game', game_code: '123456', game_title: quiz.title }) }
    if (name === 'get_host_session_health') return failHealth ? route.fulfill({ status: 503, json: { message: 'Offline' } }) : json(health)
    if (name === 'tick_practice_game') { ticks++; return json({ actions: 2, failures: 0 }) }
    if (name === 'control_practice_game') { const action = route.request().postDataJSON().p_action; controls.push(action); health.paused = action === 'pause'; return json(null) }
    return json([])
  })
  return { creates, controls, preferences, health, failHealth: (value: boolean) => { failHealth = value }, ticks: () => ticks }
}

test('first-show guide can be hidden and reopened, and launches real practice setup', async ({ page }) => {
  const mock = await fixture(page)
  await page.goto('/host')
  await expect(page.getByRole('heading', { name: 'Your first show, step by step' })).toBeVisible()
  await page.getByRole('button', { name: 'Hide guide' }).click()
  await page.getByRole('button', { name: 'First-show guide', exact: true }).click()
  await page.getByRole('button', { name: 'Practise a ready quiz →' }).click()
  await expect(page.getByRole('button', { name: 'Practice with teams' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Simulated teams').selectOption('5')
  await page.getByRole('button', { name: 'Open Practice Lobby →' }).click()
  await expect(page.getByRole('button', { name: /Practice · Session health/ })).toBeVisible()
  expect(mock.creates[0]).toMatchObject({ p_quiz_id: 'quiz', p_team_count: 5 })
  expect(mock.creates[0].p_operation_id).toBeTruthy()
  expect(mock.preferences).toHaveLength(0)
})

test('host sees honest team health and saved-answer status, with recovery after failures', async ({ page }, info) => {
  const mock = await fixture(page, true)
  await page.goto('/host')
  await expect(page.getByRole('button', { name: /Practice · Session health/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.getByRole('button', { name: /Practice · Session health/ }).click()
  const panel = page.getByRole('complementary', { name: 'Session health and practice controls' })
  await expect(panel.getByText('Recently seen', { exact: true })).toBeVisible()
  await expect(panel.getByText('Connection delayed', { exact: true })).toBeVisible()
  await expect(panel.getByText('Asleep / not recently seen')).toBeVisible()
  await expect(panel.getByText('Answer received by server')).toBeVisible()
  await expect(panel.getByText('No saved submission for this answer yet')).toHaveCount(2)
  await page.screenshot({ path: info.outputPath('session-health.png'), fullPage: true })
  mock.failHealth(true)
  await panel.getByRole('button', { name: 'Check again' }).click()
  await expect(panel.getByRole('alert')).toContainText('Connection check failed')
  mock.failHealth(false)
  await panel.getByRole('button', { name: 'Check again' }).click()
  await expect(panel.getByRole('alert')).toHaveCount(0)
})

test('practice controls pause, resume and stop only this rehearsal', async ({ page }) => {
  const mock = await fixture(page, true)
  await page.goto('/host')
  await page.getByRole('button', { name: /Practice · Session health/ }).click()
  await expect.poll(mock.ticks).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Pause teams', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resume teams' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Join on the real player screen ↗' })).toHaveAttribute('href', '/play?code=123456')
  await page.getByRole('button', { name: 'Resume teams', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause teams' })).toBeVisible()
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'End practice', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your first show, step by step' })).toBeVisible()
  expect(mock.controls).toEqual(['pause', 'resume', 'stop'])
  expect(await page.evaluate(() => localStorage.getItem('simple-trivia-host-game-id'))).toBeNull()
})

test('live shows have health checks without practice controls or simulated actions', async ({ page }) => {
  const mock = await fixture(page, true)
  mock.health.practice = false
  mock.health.teams.forEach(team => { team.simulated = false })
  await page.goto('/host')
  await page.getByRole('button', { name: /^Session health/ }).click()
  const panel = page.getByRole('complementary', { name: 'Session health and practice controls' })
  await expect(panel.getByText('Answer received by server')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Pause teams' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'End practice' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Check again' }).click()
  expect(mock.ticks()).toBe(0)
})
