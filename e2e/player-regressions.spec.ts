import { expect, test } from '@playwright/test'

const fiveAnswerQuestion = {
  question_key: 'five-answer-question',
  position: 1,
  item_position: 1,
  round_number: 1,
  round_position: 1,
  round_question_count: 1,
  round_title: 'General Knowledge',
  prompt: 'Name five examples.',
  category: 'Society & Culture',
  difficulty: 'Medium',
  question_type: 'multi-answer',
  options: null,
  image_url: null,
  points_max: 5,
  bonus: null,
  has_bonus: false,
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'browser-test-game')
  })
  await page.route('**/rest/v1/games**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ current_question_key: 'five-answer-question' }),
  }))
  await page.route('**/rest/v1/rpc/get_player_game_question', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fiveAnswerQuestion),
  }))
})

test('a five-point multi-answer question renders five answer fields', async ({ page }) => {
  await page.goto('/play/prototype')
  await page.getByRole('button', { name: '8 · Multi-Answer' }).click()

  await expect(page.getByLabel('Answer 1')).toBeVisible()
  await expect(page.getByLabel('Answer 5')).toBeVisible()
  await expect(page.getByLabel(/^Answer \d+$/)).toHaveCount(5)
})

test('the submit control follows the answer fields instead of being pinned to the viewport', async ({ page }) => {
  await page.goto('/play/prototype')
  await page.getByRole('button', { name: '8 · Multi-Answer' }).click()

  await expect(page.getByLabel(/^Answer \d+$/)).toHaveCount(5)
  const lastAnswer = page.getByLabel('Answer 5')
  const submit = page.getByRole('button', { name: 'Submit Answers' })
  await expect(submit).toBeVisible()
  const [answerBox, submitBox, position] = await Promise.all([
    lastAnswer.boundingBox(),
    submit.boundingBox(),
    submit.evaluate(element => getComputedStyle(element).position),
  ])
  expect(answerBox).not.toBeNull()
  expect(submitBox).not.toBeNull()
  expect(submitBox!.y).toBeGreaterThan(answerBox!.y + answerBox!.height)
  expect(position).not.toBe('fixed')
})

test('ranking controls visibly reorder answers', async ({ page }, testInfo) => {
  await page.unroute('**/rest/v1/rpc/get_player_game_question')
  await page.route('**/rest/v1/rpc/get_player_game_question', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ...fiveAnswerQuestion,
      question_key: 'ranking-question',
      prompt: 'Order these planets.',
      question_type: 'ranking',
      options: ['Jupiter', 'Saturn', 'Uranus', 'Neptune'],
      correct_answer: ['Jupiter', 'Saturn', 'Uranus', 'Neptune'],
      points_max: 1,
    }),
  }))
  await page.goto('/play/prototype')
  await page.getByRole('button', { name: '10 · Ranking' }).click()

  const itemLabels = page.locator('span').filter({ hasText: /^(Jupiter|Saturn|Uranus|Neptune)$/ })
  await expect(itemLabels).toHaveCount(4)
  const before = await itemLabels.allTextContents()
  const firstCard = page.locator('.rank-badge-changed').first().locator('..')
  await firstCard.getByRole('button').last().click({
    force: testInfo.project.name.startsWith('mobile'),
  })

  const after = await itemLabels.allTextContents()
  expect(after).toEqual([before[1], before[0], ...before.slice(2)])
})

test('rapid answer actions submit once and bind the response to the visible question', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('simple-trivia-team-id', 'browser-test-team'))
  await page.unroute('**/rest/v1/games**')
  await page.route('**/rest/v1/games**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      current_screen: 'single-answer',
      answer_phase: 'open',
      question_stage: 'core',
      current_question_key: 'five-answer-question',
      answer_editing_allowed: false,
      settings: {},
    }),
  }))

  const requests: Array<Record<string, unknown>> = []
  await page.route('**/rest/v1/rpc/submit_player_answer', async route => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>)
    await new Promise(resolve => setTimeout(resolve, 100))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('submission-id') })
  })

  await page.goto('/play/prototype')
  await page.getByRole('button', { name: '5 · Single Answer' }).click()
  await expect(page.getByText('Name five examples.')).toBeVisible()
  await page.getByPlaceholder('Type your answer…').fill('My carefully typed answer')
  await page.getByRole('button', { name: 'Submit Answer' }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('Submit control is not a button')
    button.click()
    button.click()
  })

  await expect.poll(() => requests.length).toBe(1)
  await page.waitForTimeout(150)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({
    p_question_key: 'five-answer-question',
    p_answer_text: 'My carefully typed answer',
  })
})

test('every player prototype state avoids horizontal overflow', async ({ page }) => {
  await page.goto('/play/prototype')
  const stateButtons = await page.locator('button').filter({ hasText: /^\d/ }).allTextContents()
  const phone = page.getByTestId('player-prototype-phone')

  for (const state of stateButtons) {
    await page.getByRole('button', { name: state, exact: true }).click({ force: true })
    await expect.poll(() => phone.evaluate(
      element => element.scrollWidth <= element.clientWidth + 1,
    ), { message: `${state} should fit the viewport without horizontal scrolling` }).toBe(true)
  }
})
