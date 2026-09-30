import { expect, test, type Locator, type Page } from '@playwright/test'

const media = 'https://images.example.test'
const question = {
  id: 'image-question', question_key: 'q1', position: 1, item_position: 1,
  round_number: 1, round_position: 1, round_question_count: 1, round_title: 'Pictures',
  prompt: 'What can you see?', question_type: 'single-answer', points_max: 1,
  correct_answer: 'Test', accepted_answers: [], options: [], image_url: `${media}/wide.svg`,
  tags: [], notes: null, metadata_snapshot: {}, source_question_id: null, source_revision: null,
  bonus: { prompt: 'And this picture?', correct_answer: 'Bonus', points: 1, image_url: `${media}/portrait.svg` },
}

async function images(page: Page) {
  await page.route(`${media}/**`, route => {
    const portrait = route.request().url().includes('portrait')
    const square = route.request().url().includes('square')
    const w = portrait ? 200 : square ? 400 : 900
    const h = portrait ? 600 : square ? 400 : 300
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ddd6fe"/><rect x="3" y="3" width="${w - 6}" height="${h - 6}" fill="none" stroke="#7c3aed" stroke-width="6"/><text x="12" y="30">All four edges must remain visible</text></svg>` })
  })
}

async function player(page: Page, src: string, stage = 'core', mechanic = 'single-answer') {
  await images(page)
  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'image-game')
    localStorage.setItem('simple-trivia-team-id', 'image-team')
    localStorage.setItem('simple-trivia-join-request-id', 'request')
    localStorage.setItem('simple-trivia-join-request-token', 'token')
  })
  const submissions: string[] = []
  await page.route('**/rest/v1/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name === 'get_team_join_request') return route.fulfill({ json: { admission_status: 'approved', team_id: 'image-team', name: 'Image team', game_status: 'live' } })
    if (name === 'get_server_epoch_ms') return route.fulfill({ json: Date.now() })
    if (name === 'games') return route.fulfill({ json: { id: 'image-game', status: 'live', current_screen: mechanic, current_question_key: 'q1', answer_phase: 'open', question_stage: stage, settings: { auto_run_mode: 'off' } } })
    if (name === 'get_player_game_question') return route.fulfill({ json: { ...question, correct_answer: null, question_type: mechanic, image_url: src } })
    if (name === 'teams') return route.fulfill({ json: { id: 'image-team', game_id: 'image-game', name: 'Image team', score: 0 } })
    if (name === 'get_owned_player_submission') return route.fulfill({ json: null })
    if (name === 'submit_owned_player_answer') { submissions.push(route.request().postDataJSON().p_answer_text); return route.fulfill({ json: 'submission' }) }
    return route.fulfill({ json: [] })
  })
  return submissions
}

async function proportional(image: Locator, ratio: number) {
  await expect(image).toBeVisible()
  const size = await image.evaluate((element: HTMLImageElement) => {
    const box = element.getBoundingClientRect()
    return { width: box.width, height: box.height, natural: element.naturalWidth / element.naturalHeight, fit: getComputedStyle(element).objectFit }
  })
  expect(size.natural).toBeCloseTo(ratio, 2)
  expect(size.width).toBeGreaterThan(50)
  expect(size.width / size.height).toBeCloseTo(ratio, 2)
  expect(size.fit).toBe('contain')
}

for (const [shape, ratio] of [['wide', 3], ['portrait', 1 / 3], ['square', 1]] as const) {
  test(`player ${shape} image keeps its ratio and enlarging preserves an answer draft`, async ({ page }, testInfo) => {
    const submissions = await player(page, `${media}/${shape}.svg`)
    await page.goto('/play')
    const image = page.getByRole('button', { name: 'Enlarge question image', exact: true }).getByRole('img')
    await proportional(image, ratio)
    const input = page.getByPlaceholder('Type your answer…')
    await input.fill('My draft')
    await page.getByRole('button', { name: 'Enlarge question image', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Question image enlarged', exact: true })
    await proportional(dialog.getByRole('img'), ratio)
    const beforeZoom = await dialog.getByRole('img').boundingBox()
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect.poll(async () => (await dialog.getByRole('img').boundingBox())!.width).toBeGreaterThan(beforeZoom!.width * 1.4)
    await page.getByRole('button', { name: 'Reset image zoom' }).click()
    await proportional(dialog.getByRole('img'), ratio)
    await page.screenshot({ path: testInfo.outputPath(`${shape}-enlarged.png`) })
    await page.getByRole('button', { name: 'Close image', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(input).toHaveValue('My draft')
    expect(submissions).toEqual([])
    await expect(page.getByRole('button', { name: 'Submit Answer', exact: true })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${shape}-question.png`), fullPage: true })
  })
}

test('a failed image has a useful retry without losing the answer', async ({ page }) => {
  await player(page, `${media}/broken.svg`)
  let broken = true
  await page.route(`${media}/broken.svg`, route => broken ? route.fulfill({ status: 404, body: 'Not found' }) : route.fallback())
  await page.goto('/play')
  await expect(page.getByText(/Image couldn’t load/)).toBeVisible()
  await page.getByPlaceholder('Type your answer…').fill('Still here')
  broken = false
  await page.getByRole('button', { name: 'Retry image' }).click()
  await proportional(page.getByRole('button', { name: 'Enlarge question image' }).getByRole('img'), 3)
  await expect(page.getByPlaceholder('Type your answer…')).toHaveValue('Still here')
})

for (const height of [320, 412]) {
  test(`image zoom keeps every edge reachable on a ${height}px landscape screen and refits after rotation`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 839, height })
    await player(page, `${media}/portrait.svg`)
    await page.goto('/play')
    await page.getByPlaceholder('Type your answer…').fill('Keep this draft')
    await page.getByRole('button', { name: 'Enlarge question image', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Question image enlarged' })
    const image = dialog.getByRole('img')
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    const bounds = await image.evaluate(element => {
      const viewport = element.parentElement!
      viewport.scrollTop = viewport.scrollHeight
      viewport.scrollLeft = viewport.scrollWidth
      const img = element.getBoundingClientRect()
      const view = viewport.getBoundingClientRect()
      const modal = element.closest('dialog')!.getBoundingClientRect()
      return { imageBottom: img.bottom, imageRight: img.right, viewportBottom: view.bottom, viewportRight: view.right, dialogBottom: modal.bottom, dialogRight: modal.right }
    })
    expect(bounds.viewportBottom).toBeLessThanOrEqual(bounds.dialogBottom - 10)
    expect(bounds.viewportRight).toBeLessThanOrEqual(bounds.dialogRight - 10)
    expect(bounds.imageBottom).toBeLessThanOrEqual(bounds.viewportBottom + 1)
    expect(bounds.imageRight).toBeLessThanOrEqual(bounds.viewportRight + 1)
    await page.screenshot({ path: testInfo.outputPath('landscape-zoom-bottom.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Reset image zoom' }).click()
    await expect.poll(() => image.evaluate(element => {
      const img = element.getBoundingClientRect(), viewport = element.parentElement!.getBoundingClientRect()
      return img.height <= viewport.height + 1 && img.width <= viewport.width + 1
    })).toBe(true)
    await page.getByRole('button', { name: 'Close image', exact: true }).click()
    await expect(page.getByPlaceholder('Type your answer…')).toHaveValue('Keep this draft')
    await page.getByRole('button', { name: 'Enlarge question image', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Reset image zoom' })).toHaveText('100% · Reset')
  })
}

test('bonus images use the same full-image layout', async ({ page }) => {
  await player(page, `${media}/wide.svg`, 'bonus')
  await page.goto('/play')
  await proportional(page.getByRole('button', { name: 'Enlarge bonus image' }).getByRole('img'), 1 / 3)
  await expect(page.getByRole('button', { name: 'Enlarge question image' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Submit Bonus Answer', exact: true })).toBeVisible()
})

for (const mechanic of ['image-question', 'multiple-choice', 'multi-answer', 'multi-part', 'ranking']) {
  test(`${mechanic} supports attached images`, async ({ page }) => {
    await player(page, `${media}/wide.svg`, 'core', mechanic)
    await page.route('**/rest/v1/rpc/get_player_game_question', route => route.fulfill({ json: {
      ...question, question_type: mechanic, correct_answer: null, points_max: mechanic === 'multi-part' || mechanic === 'multi-answer' ? 2 : 1,
      options: mechanic === 'ranking' ? ['First', 'Second', 'Third'] : [{ key: 'A', label: 'A', clue: 'First clue' }, { key: 'B', label: 'B', clue: 'Second clue' }],
    } }))
    await page.goto('/play')
    await proportional(page.getByRole('button', { name: 'Enlarge question image', exact: true }).getByRole('img'), 3)
  })
}

test('portrait content screens are not cropped', async ({ page }) => {
  await player(page, `${media}/portrait.svg`, 'core', 'content-screen')
  await page.route('**/rest/v1/games**', route => route.fulfill({ json: { id: 'image-game', status: 'live', current_screen: 'content-screen', current_content_screen_key: 'content-1', answer_phase: 'closed', settings: {} } }))
  await page.route('**/rest/v1/game_content_screens**', route => route.fulfill({ json: { screen_key: 'content-1', title: 'Picture break', body: 'A full portrait', round_number: 1, round_title: 'Pictures', image_url: `${media}/portrait.svg` } }))
  await page.goto('/play')
  await proportional(page.getByRole('button', { name: 'Enlarge content screen image' }).getByRole('img'), 1 / 3)
})

async function host(page: Page, live: boolean) {
  await images(page)
  const userId = '00000000-0000-4000-8000-000000000001'
  await page.addInitScript(({ userId, live }) => {
    const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: userId, exp: 4102444800, role: 'authenticated' }))}.test`
    localStorage.setItem('sb-fubensgmepniquokbmmw-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: userId, email: 'host@example.test', aud: 'authenticated', role: 'authenticated' } }))
    if (live) localStorage.setItem('simple-trivia-host-game-id', 'image-game')
  }, { userId, live })
  const gameWrites: unknown[] = []
  await page.route('**/auth/v1/**', route => route.fulfill({ json: { id: userId, email: 'host@example.test', aud: 'authenticated', role: 'authenticated' } }))
  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url()), name = url.pathname.split('/').pop()
    if (name === 'get_server_epoch_ms') return route.fulfill({ json: Date.now() })
    if (name === 'quizzes') {
      const quiz = { id: 'image-quiz', owner_id: userId, folder_id: null, title: 'Image fixture', status: 'ready', round_count: 1, question_count: 1 }
      return route.fulfill({ json: url.searchParams.has('id') ? quiz : [quiz] })
    }
    if (name === 'quiz_questions' || name === 'game_questions') return route.fulfill({ json: [question] })
    if (name === 'games') {
      if (route.request().method() !== 'GET') gameWrites.push(route.request().postDataJSON())
      return route.fulfill({ json: { id: 'image-game', quiz_id: 'image-quiz', code: '123456', status: 'live', current_screen: 'single-answer', current_question_key: 'q1', question_stage: 'core', answer_phase: 'open', settings: { auto_run_mode: 'off' } } })
    }
    return route.fulfill({ json: [] })
  })
  return gameWrites
}

test('host image and bonus retain proportions; enlarged-image keyboard does not advance play', async ({ page }) => {
  const writes = await host(page, true)
  await page.goto('/host')
  await proportional(page.getByRole('button', { name: 'Enlarge question image', exact: true }).getByRole('img'), 3)
  await proportional(page.getByRole('button', { name: 'Enlarge bonus image', exact: true }).getByRole('img'), 1 / 3)
  const before = writes.length
  await page.getByRole('button', { name: 'Enlarge question image', exact: true }).click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Question image enlarged' })).not.toBeVisible()
  expect(writes).toHaveLength(before)
})

test('builder shows the actual image and URL changes recover from an invalid preview', async ({ page }) => {
  await host(page, false)
  await page.goto('/host')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await proportional(page.getByRole('button', { name: 'Enlarge question image', exact: true }).getByRole('img'), 3)
  await page.getByText('What can you see?', { exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Question image URL', exact: true })
  await input.fill('not-an-image-url')
  await expect(page.getByText(/Image couldn’t load/)).toBeVisible()
  await input.fill(`${media}/portrait.svg`)
  await expect(page.getByText(/Image couldn’t load/)).toHaveCount(0)
  await proportional(page.getByRole('button', { name: 'Enlarge question image', exact: true }).last().getByRole('img'), 1 / 3)
})

test('quiz preview shows main and bonus images', async ({ page }) => {
  await host(page, false)
  await page.goto('/host')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Preview Quiz', exact: true }).click()
  const preview = page.locator('section').filter({ has: page.getByText('Player Preview', { exact: true }) })
  await proportional(preview.getByRole('button', { name: 'Enlarge question image', exact: true }).getByRole('img'), 3)
  await proportional(preview.getByRole('button', { name: 'Enlarge bonus image', exact: true }).getByRole('img'), 1 / 3)
})
