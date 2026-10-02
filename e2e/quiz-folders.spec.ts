import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, failReorder = false, gameCount = 0) {
  const userId = '00000000-0000-4000-8000-000000000001'
  await page.addInitScript(({ userId }) => {
    const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: userId, exp: 4102444800, role: 'authenticated' }))}.test`
    localStorage.setItem('sb-fubensgmepniquokbmmw-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: userId, email: 'host@example.test', aud: 'authenticated', role: 'authenticated' } }))
  }, { userId })
  let folders = ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({ id: name, name, owner_id: userId, sort_position: index, created_at: '2026-09-28', updated_at: '2026-09-28' }))
  const quiz = { id: 'quiz', owner_id: userId, folder_id: null as string | null, title: 'Folder test quiz', status: 'draft', round_count: 0, question_count: 0, updated_at: '2026-09-28', show_games: [{ count: gameCount }] }
  let copiedQuiz: typeof quiz | null = null
  const reorders: string[][] = []
  await page.route('**/auth/v1/**', route => route.fulfill({ json: { id: userId, email: 'host@example.test', aud: 'authenticated', role: 'authenticated' } }))
  await page.route('**/rest/v1/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name === 'quiz_folders') return route.fulfill({ json: folders })
    if (name === 'quizzes') {
      if (route.request().method() === 'PATCH') {
        quiz.folder_id = route.request().postDataJSON().folder_id
        return route.fulfill({ json: { folder_id: quiz.folder_id } })
      }
      if (new URL(route.request().url()).searchParams.get('id') === 'eq.quiz-copy') return route.fulfill({ json: copiedQuiz })
      return route.fulfill({ json: copiedQuiz ? [quiz, copiedQuiz] : [quiz] })
    }
    if (name === 'duplicate_owned_quiz') {
      copiedQuiz = { ...quiz, id: 'quiz-copy', title: route.request().postDataJSON().p_title }
      return route.fulfill({ json: { ...copiedQuiz, show_games: undefined } })
    }
    if (name === 'reorder_quiz_folders') {
      const ids = route.request().postDataJSON().p_folder_ids as string[]
      reorders.push(ids)
      if (failReorder) return route.fulfill({ status: 500, json: { message: 'Test save failure' } })
      folders = ids.map((id, index) => ({ ...folders.find(folder => folder.id === id)!, sort_position: index }))
      return route.fulfill({ status: 204, body: '' })
    }
    return route.fulfill({ json: [] })
  })
  await page.goto('/host')
  return { reorders, quiz }
}

test('folder drag order persists and quizzes still drop into collapsed folders', async ({ page }) => {
  const { reorders, quiz } = await fixture(page)
  await page.getByRole('button', { name: 'Close Alpha', exact: true }).click()
  await page.getByRole('button', { name: 'Reorder Gamma', exact: true }).dragTo(page.getByRole('button', { name: 'Reorder Alpha', exact: true }))
  await expect.poll(() => reorders).toEqual([['Gamma', 'Alpha', 'Beta']])
  await expect(page.getByText('Folder order saved.', { exact: true })).toBeVisible()
  await page.reload()
  await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['Reorder Gamma', 'Reorder Alpha', 'Reorder Beta'])
  await page.getByRole('button', { name: 'Close Gamma', exact: true }).click()
  await page.getByRole('button', { name: 'Close Beta', exact: true }).click()
  await page.getByTitle('Drag this quiz into a folder', { exact: true }).dragTo(page.getByRole('button', { name: 'Open Alpha', exact: true }), { sourcePosition: { x: 20, y: 25 } })
  await expect.poll(() => quiz.folder_id).toBe('Alpha')
  expect(reorders).toHaveLength(1)
})

test('failed folder save restores the visible order and keyboard reorder uses the same save', async ({ page }) => {
  const { reorders } = await fixture(page, true)
  await page.getByRole('button', { name: 'Reorder Alpha', exact: true }).press('ArrowDown')
  await expect.poll(() => reorders).toEqual([['Beta', 'Alpha', 'Gamma']])
  await expect(page.getByText(/Could not save the folder order/)).toBeVisible()
  await expect.poll(() => page.getByRole('button', { name: /^Reorder / }).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['Reorder Alpha', 'Reorder Beta', 'Reorder Gamma'])
})

test('quiz actions close on an outside click or tap and still toggle from the dots', async ({ page, isMobile }) => {
  await fixture(page)
  const trigger = page.getByRole('button', { name: 'Quiz actions for Folder test quiz', exact: true })
  const rename = page.getByRole('button', { name: 'Rename Quiz', exact: true })
  await trigger.click()
  await expect(rename).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const outside = page.getByText('Games hosted', { exact: true })
  if (isMobile) await outside.tap()
  else await outside.click()
  await expect(rename).toHaveCount(0)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect(rename).toBeVisible()
  await trigger.click()
  await expect(rename).toHaveCount(0)
})

test('quiz menu keeps internal controls usable and Escape returns focus to the dots', async ({ page }) => {
  const { quiz } = await fixture(page)
  const trigger = page.getByRole('button', { name: 'Quiz actions for Folder test quiz', exact: true })
  await trigger.click()
  const folders = page.getByLabel('Move to folder')
  await page.getByRole('button', { name: 'Rename Quiz', exact: true }).locator('..').click({ position: { x: 3, y: 3 } })
  await expect(folders).toBeVisible()
  await folders.focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Rename Quiz', exact: true })).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await folders.selectOption('Alpha')
  await expect.poll(() => quiz.folder_id).toBe('Alpha')
  await expect(page.getByRole('button', { name: 'Rename Quiz', exact: true })).toHaveCount(0)
})

test('game-only quiz cards show saved games and retain the count after duplication', async ({ page }) => {
  await fixture(page, false, 4)
  await expect(page.getByText('0 questions', { exact: true })).toBeVisible()
  await expect(page.getByText('4 games', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Quiz actions for Folder test quiz', exact: true }).click()
  await page.getByRole('button', { name: 'Duplicate Quiz', exact: true }).click()
  await expect(page.getByText('4 games', { exact: true })).toHaveCount(2)
  await page.reload()
  await expect(page.getByText('4 games', { exact: true })).toHaveCount(2)
})

test('a quiz card uses singular game wording and fits a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await fixture(page, false, 1)
  await expect(page.getByText('1 game', { exact: true })).toBeVisible()
  const card = page.getByTitle('Drag this quiz into a folder', { exact: true })
  await expect.poll(() => card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
})
