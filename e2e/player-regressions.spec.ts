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
  await page.goto('/play/prototype')
  await page.getByRole('button', { name: '10 · Ranking' }).click()

  const rankingCards = page.locator('div').filter({ has: page.getByText('Jupiter', { exact: true }) })
  const jupiterCard = rankingCards.last()
  await jupiterCard.getByRole('button').last().click({
    force: testInfo.project.name.startsWith('mobile'),
  })

  const labels = await page.locator('span').filter({ hasText: /^(Jupiter|Saturn|Uranus|Neptune)$/ }).allTextContents()
  expect(labels).toEqual(['Saturn', 'Jupiter', 'Uranus', 'Neptune'])
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
