import { expect, test, type Page } from '@playwright/test'

const question = {
  question_key: 'q1', position: 1, item_position: 1, round_number: 1,
  round_position: 1, round_question_count: 1, round_title: 'Speed test',
  prompt: 'Name two planets', question_type: 'multi-answer', points_max: 2,
  correct_answer: ['Mercury', 'Venus'], accepted_answers: [[], []], has_bonus: false, bonus: null,
}

async function playerFixture(page: Page, seconds = 45, revealed = false) {
  const deadline = Date.now() + seconds * 1000
  const requests: string[] = []
  let saved: { id: string; answer_text: string; is_correct: boolean | null; points_awarded: number; grading_json: null } | null = revealed ? { id: 's1', answer_text: '["Mercury","Venus"]', is_correct: true, points_awarded: 75, grading_json: null } : null
  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'speed-game')
    localStorage.setItem('simple-trivia-team-id', 'speed-team')
  })
  await page.route('**/rest/v1/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name === 'games') return route.fulfill({ json: { id: 'speed-game', status: 'live', current_screen: 'multi-answer', current_question_key: 'q1', answer_phase: revealed ? 'revealed' : 'open', question_stage: 'core', answer_editing_allowed: true,
      settings: { scoring_mode: 'speed', auto_run_mode: 'off', answer_reveal: 'each', speed_clock: revealed ? null : { key: 'speed-q1-core', deadline_ms: deadline, duration_seconds: 45 } } } })
    if (name === 'get_player_game_question') return route.fulfill({ json: question })
    if (name === 'teams') return route.fulfill({ json: { id: 'speed-team', game_id: 'speed-game', name: 'Test team', score: revealed ? 75 : 0 } })
    if (name === 'submissions') return route.fulfill({ json: saved })
    if (name === 'submit_player_answer') {
      requests.push(route.request().postDataJSON().p_answer_text)
      saved = { id: 's1', answer_text: requests.at(-1)!, is_correct: null, points_awarded: 0, grading_json: null }
      return route.fulfill({ json: 's1' })
    }
    return route.fulfill({ json: [] })
  })
  return { requests, deadline }
}

test('manual speed game shows a countdown without changing the number of answer fields', async ({ page }, testInfo) => {
  const { deadline } = await playerFixture(page)
  await page.goto('/play')
  await expect(page.getByLabel(/^Answer \d+$/)).toHaveCount(2)
  await expect(page.getByRole('timer')).toBeVisible()
  await expect(page.getByText(/Speed scoring · up to \d+ points/)).toBeVisible()
  await page.getByLabel('Answer 1').fill('Mercury')
  await expect(page.getByRole('button', { name: 'Submit Answers', exact: true })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('speed-question.png'), fullPage: true })
  await page.reload()
  await expect(page.getByLabel('Answer 1')).toHaveValue('Mercury')
  await expect(page.getByRole('timer')).toBeVisible()
  const text = await page.getByRole('timer').textContent()
  const remaining = Number(text!.match(/(\d+):(\d+)/)?.[2])
  expect(remaining).toBeLessThanOrEqual(Math.ceil((deadline - Date.now()) / 1000) + 1)
})

test('speed timer submits a partially completed answer without Auto-Run', async ({ page }) => {
  const { requests } = await playerFixture(page, 6)
  await page.goto('/play')
  await page.getByLabel('Answer 1').fill('Merc')
  await expect.poll(() => requests, { timeout: 12000 }).toEqual(['["Merc",""]'])
})

test('a fully correct 75-point answer is still shown as correct', async ({ page }) => {
  await playerFixture(page, 45, true)
  await page.goto('/play')
  await expect(page.getByRole('heading', { name: 'Correct!', exact: true })).toBeVisible()
  await expect(page.getByText('75 points', { exact: true })).toBeVisible()
})

async function hostFixture(page: Page) {
  const userId = '00000000-0000-4000-8000-000000000001'
  const bodies: Record<string, unknown>[] = []
  await page.addInitScript(({ userId }) => {
    const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: userId, exp: 4102444800, role: 'authenticated' }))}.test`
    localStorage.setItem('sb-fubensgmepniquokbmmw-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: userId, email: 'host@example.test', aud: 'authenticated', role: 'authenticated' } }))
  }, { userId })
  await page.route('**/auth/v1/**', route => route.fulfill({ json: { id: userId, email: 'host@example.test', aud: 'authenticated', role: 'authenticated' } }))
  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url())
    const name = url.pathname.split('/').pop()
    if (name === 'quizzes') {
      const quiz = { id: 'speed-quiz', owner_id: userId, folder_id: null, title: 'Speed fixture', status: 'ready', round_count: 1, question_count: 1, updated_at: '2026-09-24' }
      return route.fulfill({ json: url.searchParams.has('id') ? quiz : [quiz] })
    }
    if (name === 'create_game_from_quiz_with_show_games') {
      bodies.push(route.request().postDataJSON())
      // Stop before opening a real lobby: this test only verifies the setup payload.
      return route.fulfill({ status: 400, json: { message: 'Fixture stopped after capturing settings' } })
    }
    return route.fulfill({ json: [] })
  })
  return bodies
}

test('host can choose fixed speed points independently of Auto-Run', async ({ page }, testInfo) => {
  const bodies = await hostFixture(page)
  await page.goto('/host')
  await page.getByRole('button', { name: 'Host Game', exact: true }).click()
  await page.getByRole('button', { name: 'Speed-based points', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Speed-based points', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Normal', exact: true }).click()
  await expect(page.getByText('Question timer speed — fixed for this game', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('speed-setup.png'), fullPage: true })
  await page.getByRole('button', { name: 'Open Fresh Lobby →', exact: true }).click()
  await expect.poll(() => bodies.length).toBe(1)
  expect(bodies[0]).toMatchObject({ p_settings: { scoring_mode: 'speed', auto_run_mode: 'off', auto_run_speed: 'medium' } })
})

test('host closes timed answers without Auto-Run and opens a fresh bonus clock without Realtime', async ({ page }) => {
  await hostFixture(page)
  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-host-game-id', 'speed-game')
    localStorage.setItem('simple-trivia-host-game-code', '123456')
  })
  let deadline = Date.now() + 6000
  let stage = 'core'
  let phase = 'open'
  const writes: Record<string, unknown>[] = []
  await page.route('**/rest/v1/games**', route => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      writes.push(body)
      if (body.question_stage === 'bonus') { stage = 'bonus'; deadline = Date.now() + 30000 }
      if (body.answer_phase) phase = body.answer_phase
      return route.fulfill({ status: 204, body: '' })
    }
    return route.fulfill({ json: { id: 'speed-game', code: '123456', title: 'Speed fixture', quiz_id: 'speed-quiz', status: 'live', current_screen: 'multi-answer', current_question_key: 'q1', question_stage: stage, answer_phase: phase, answer_editing_allowed: true,
      settings: { scoring_mode: 'speed', auto_run_mode: 'off', speed_clock: phase === 'open' ? { key: `speed-q1-${stage}`, deadline_ms: deadline, duration_seconds: stage === 'core' ? 45 : 30 } : null } } })
  })
  await page.route('**/rest/v1/game_questions**', route => route.fulfill({ json: [{ ...question, bonus: { prompt: 'Bonus planet?', correct_answer: 'Mars', points: 1 } }] }))
  await page.goto('/host')
  await expect(page.getByRole('timer')).toContainText('Speed points')
  await expect.poll(() => writes.some(write => write.answer_phase === 'closed'), { timeout: 12000 }).toBe(true)
  await page.getByRole('button', { name: /Open Bonus/i }).click()
  await expect(page.getByRole('timer')).toContainText(/00:2\d|00:30/)
  const closedCount = writes.filter(write => write.answer_phase === 'closed').length
  await page.waitForTimeout(1500)
  expect(writes.filter(write => write.answer_phase === 'closed')).toHaveLength(closedCount)
  await page.reload()
  await expect(page.getByRole('timer')).toContainText(/00:2\d/)
})
