import { expect, test, type Page } from '@playwright/test'

async function mockBonus(page: Page, editing = true, timed = false) {
  let saved: { answer_text: string; is_correct: null; points_awarded: number; grading_json: null } | null = null
  const requests: string[] = []
  let deadline = Date.now() + 60000
  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'bonus-test-game')
    localStorage.setItem('simple-trivia-team-id', 'bonus-test-team')
  })
  await page.route('**/rest/v1/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name === 'games') return route.fulfill({ json: { id: 'bonus-test-game', status: 'live', current_screen: 'single-answer', current_question_key: 'q1', answer_phase: 'open', question_stage: 'bonus', answer_editing_allowed: editing, settings: { auto_run_clock: timed ? { key: 'open-q1-bonus', label: 'Answers close in', deadline_ms: deadline, paused_remaining: null } : null } } })
    if (name === 'get_player_game_question') return route.fulfill({ json: { question_key: 'q1', position: 1, item_position: 1, round_number: 1, round_position: 1, round_question_count: 1, round_title: 'Bonus test', prompt: 'Main question', question_type: 'single-answer', points_max: 1, has_bonus: true, bonus: { prompt: 'Bonus fixture', points: 1 } } })
    if (name === 'teams') return route.fulfill({ json: { id: 'bonus-test-team', game_id: 'bonus-test-game', name: 'Test team', score: 0 } })
    if (name === 'submit_player_bonus_answer') {
      const answer = route.request().postDataJSON().p_answer_text
      requests.push(answer)
      saved = { answer_text: answer, is_correct: null, points_awarded: 0, grading_json: null }
      return route.fulfill({ json: 'bonus-submission' })
    }
    if (name === 'get_player_bonus_submission') return route.fulfill({ json: saved ? [saved] : [] })
    return route.fulfill({ json: [] })
  })
  return { requests, setDeadline: () => { deadline = Date.now() + 3500 } }
}

test('bonus drafts survive refresh and do not overwrite the core answer draft', async ({ page }) => {
  await mockBonus(page)
  await page.goto('/play')
  const input = page.getByPlaceholder('Type your answer…')
  await expect(page.getByText('Bonus fixture', { exact: true })).toBeVisible()
  await page.evaluate(() => localStorage.setItem('simple-trivia-answer-draft:bonus-test-game:bonus-test-team:q1', JSON.stringify('Core draft')))
  await input.fill('Washington, D.C.')
  await page.reload()
  await expect(input).toHaveValue('Washington, D.C.')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('simple-trivia-answer-draft:bonus-test-game:bonus-test-team:q1')!))).toBe('Core draft')
})

test('editable bonus submissions remain open and confirm updates', async ({ page }) => {
  const { requests } = await mockBonus(page)
  await page.goto('/play')
  const input = page.getByPlaceholder('Type your answer…')
  await input.fill('First')
  await page.getByRole('button', { name: 'Submit Bonus Answer', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Bonus answer submitted')
  await expect(input).toBeVisible()
  await input.fill('Replacement')
  await page.getByRole('button', { name: 'Update Bonus Answer', exact: true }).click()
  await expect.poll(() => requests).toEqual(['First', 'Replacement'])
  await expect(page.getByRole('status')).toContainText('replaced the previous one')
  await expect(page.getByRole('heading', { name: 'Answers locked in' })).toHaveCount(0)
})

test('bonus drafts submit at the answer deadline', async ({ page }) => {
  const { requests, setDeadline } = await mockBonus(page, true, true)
  setDeadline()
  await page.goto('/play')
  await page.getByPlaceholder('Type your answer…').fill('Partially typed bon')
  await expect.poll(() => requests, { timeout: 10000 }).toEqual(['Partially typed bon'])
})

test('locked bonus submissions still show the confirmation screen', async ({ page }) => {
  await mockBonus(page, false)
  await page.goto('/play')
  await page.getByPlaceholder('Type your answer…').fill('Final answer')
  await page.getByRole('button', { name: 'Submit Bonus Answer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Answers locked in' })).toBeVisible()
})
