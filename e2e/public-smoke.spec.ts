import { expect, test, type Page } from '@playwright/test'

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )).toBe(true)
}

test('landing page reaches the host and player entry points', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Good Trivia Company' })).toBeVisible()
  await expect(page.locator('a[href="/host"]')).toBeVisible()
  await expect(page.locator('a[href="/play"]')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('signed-out hosts see a usable authentication form', async ({ page }) => {
  await page.goto('/host')

  await expect(page.getByRole('heading', { name: 'Host sign in' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeEditable()
  await expect(page.getByLabel('Password')).toBeEditable()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  await expectNoHorizontalOverflow(page)
})

test('player join codes accept digits only and show a useful invalid-code state', async ({ page }) => {
  await page.route('**/rest/v1/games**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: 'null',
  }))
  await page.goto('/play')

  const code = page.getByPlaceholder('000000')
  await code.fill('ab12 34-56')
  await expect(code).toHaveValue('123456')
  await page.getByRole('button', { name: 'Join Game', exact: true }).click()

  await expect(page.getByText('We couldn’t find that game.')).toBeVisible()
  await expect(page.getByText('Check the code and try again.')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('a new QR code clears a stale player session before joining', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'old-game')
    localStorage.setItem('simple-trivia-game-code', '111111')
    localStorage.setItem('simple-trivia-team-id', 'old-team')
    localStorage.setItem('simple-trivia-team-name', 'Old Team')
  })
  await page.route('**/rest/v1/games**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: 'null',
  }))

  await page.goto('/play?code=654321')

  await expect(page.getByPlaceholder('000000')).toHaveValue('654321')
  await expect(page.getByText('We couldn’t find that game.')).toBeVisible()
  await expect.poll(() => page.evaluate(() => ({
    gameId: localStorage.getItem('simple-trivia-game-id'),
    teamId: localStorage.getItem('simple-trivia-team-id'),
  }))).toEqual({ gameId: null, teamId: null })
})

test('refreshing a same-game QR link restores the existing approved team', async ({ page }) => {
  const qrGameLookups: string[] = []

  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'live-game')
    localStorage.setItem('simple-trivia-game-code', '123456')
    localStorage.setItem('simple-trivia-game-title', 'Friday Trivia')
    localStorage.setItem('simple-trivia-team-id', 'existing-team')
    localStorage.setItem('simple-trivia-team-name', 'The Blim Blams')
    localStorage.setItem('simple-trivia-join-request-id', 'join-request')
    localStorage.setItem('simple-trivia-join-request-token', 'join-token')
  })
  await page.route('**/rest/v1/rpc/get_team_join_request', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      admission_status: 'approved',
      team_id: 'existing-team',
      name: 'The Blim Blams',
      game_status: 'live',
    }),
  }))
  await page.route('**/rest/v1/games**', route => {
    if (new URL(route.request().url()).searchParams.get('code')) qrGameLookups.push(route.request().url())
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'live',
        current_screen: 'round-start',
        answer_phase: 'closed',
        answer_editing_allowed: false,
        question_stage: 'main',
        current_question_key: null,
        current_content_screen_key: null,
        current_show_game_key: null,
      }),
    })
  })

  await page.goto('/play?code=123456')

  await expect(page.getByRole('button', { name: 'Leave game' })).toBeVisible()
  await expect(page.getByText('Loading round…')).toBeVisible()
  await expect(page.getByLabel('Team name')).toHaveCount(0)
  expect(qrGameLookups).toEqual([])
  await expect.poll(() => page.evaluate(() => localStorage.getItem('simple-trivia-team-id')))
    .toBe('existing-team')
})

test('mobile join controls remain reachable when the team-name field is focused', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile layout regression')

  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'game-mobile')
    localStorage.setItem('simple-trivia-game-code', '123456')
    localStorage.setItem('simple-trivia-game-title', 'Mobile Test Quiz')
  })
  await page.route('**/rest/v1/games**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'lobby',
      current_screen: 'lobby',
      answer_phase: null,
      question_stage: null,
      current_question_key: null,
      current_content_screen_key: null,
    }),
  }))
  await page.route('**/rest/v1/teams**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: 'null',
  }))

  await page.goto('/play')
  const teamName = page.getByLabel('Team name')
  await teamName.fill('Pocket Rockets')
  await teamName.focus()

  const joinButton = page.getByRole('button', { name: 'Ask to join' })
  await joinButton.scrollIntoViewIfNeeded()
  await expect(joinButton).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('players can create an optional team PIN when joining', async ({ page }) => {
  let joinRequest: Record<string, unknown> | null = null

  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'pin-game')
    localStorage.setItem('simple-trivia-game-code', '123456')
    localStorage.setItem('simple-trivia-game-title', 'PIN Test Quiz')
  })
  await page.route('**/rest/v1/games**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'lobby',
      current_screen: 'lobby',
      answer_phase: null,
      question_stage: null,
      current_question_key: null,
      current_content_screen_key: null,
    }),
  }))
  await page.route('**/rest/v1/teams**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }))
  await page.route('**/rest/v1/rpc/join_live_game', async route => {
    joinRequest = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'pin-team', name: 'Pocket Rockets', score: 0 }),
    })
  })

  await page.goto('/play')
  await page.getByLabel('Team name').fill('Pocket Rockets')
  await page.getByRole('button', { name: 'Create a team PIN' }).click()
  await page.getByLabel('New team PIN').fill('48-21')
  await expect(page.getByLabel('New team PIN')).toHaveValue('4821')
  await page.getByRole('button', { name: 'Create PIN & Ask to Join' }).click()

  await expect(page.getByRole('heading', { name: 'Waiting for host approval' })).toBeVisible()
  expect(joinRequest).toMatchObject({
    p_game_id: 'pin-game',
    p_team_name: 'Pocket Rockets',
    p_team_pin: '4821',
    p_pin_mode: 'create',
  })
})

test('an unmatched existing team PIN gives useful guidance', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'pin-game')
    localStorage.setItem('simple-trivia-game-code', '123456')
  })
  await page.route('**/rest/v1/games**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'lobby',
      current_screen: 'lobby',
      answer_phase: null,
      question_stage: null,
      current_question_key: null,
      current_content_screen_key: null,
    }),
  }))
  await page.route('**/rest/v1/rpc/join_live_game', route => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'P0001', message: 'TEAM_PIN_NOT_FOUND', details: null, hint: null }),
  }))

  await page.goto('/play')
  await page.getByLabel('Team name').fill('Pocket Rockets')
  await page.getByRole('button', { name: 'I already have a team PIN' }).click()
  await page.getByLabel('Existing team PIN').fill('4821')
  await page.getByRole('button', { name: 'Link Team & Ask to Join' }).click()

  await expect(page.getByText('We couldn’t match that team name and PIN.')).toBeVisible()
})
