import { expect, test, type Page } from '@playwright/test'

const userId = '00000000-0000-4000-8000-000000000001'
const otherId = '00000000-0000-4000-8000-000000000002'

async function mockAdmin(page: Page, access: 'host' | 'admin' | 'super_admin') {
  await page.addInitScript(({ userId }) => {
    const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: userId, exp: 4102444800, role: 'authenticated' }))}.test-signature`
    localStorage.setItem('sb-fubensgmepniquokbmmw-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'test-refresh', expires_at: 4102444800,
      expires_in: 3600, token_type: 'bearer', user: { id: userId, email: 'admin@example.test', aud: 'authenticated', role: 'authenticated' },
    }))
  }, { userId })
  await page.route('**/auth/v1/**', route => route.fulfill({ json: { id: userId, email: 'admin@example.test', aud: 'authenticated', role: 'authenticated' } }))
  await page.route('**/rest/v1/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name === 'is_platform_admin') return route.fulfill({ json: access !== 'host' })
    if (name === 'is_platform_super_admin') return route.fulfill({ json: access === 'super_admin' })
    if (name === 'get_platform_admin_dashboard') return route.fulfill({ json: {} })
    if (name === 'admin_list_users') return route.fulfill({ json: [{ user_id: otherId, email: 'host@example.test', display_name: 'Test Host', role: 'host', created_at: '2026-01-01', quiz_count: 2, total_count: 1, is_self: false }] })
    return route.fulfill({ json: [], headers: { 'content-range': '0-0/0' } })
  })
  await page.goto('/admin')
}

test('ordinary hosts cannot open the admin console', async ({ page }) => {
  await mockAdmin(page, 'host')
  await expect(page.getByRole('heading', { name: 'Admin access required' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Users & access' })).toHaveCount(0)
})

test('admins can create library drafts but cannot manage user access', async ({ page }) => {
  await mockAdmin(page, 'admin')
  await expect(page.getByRole('button', { name: 'Users & access' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Question Library', exact: true }).click()
  await page.getByRole('button', { name: '+ Write New', exact: true }).click()
  await page.getByLabel('Question text', { exact: true }).fill('Which planet is nearest the Sun?')
  await page.getByPlaceholder('Correct answer', { exact: true }).fill('Mercury')
  await expect(page.getByLabel('Library status')).toHaveValue('draft')
  await expect(page.getByLabel('Verified — checked for accuracy')).not.toBeChecked()
  let body: Record<string, unknown> = {}
  await page.route('**/rest/v1/rpc/admin_save_library_question', route => {
    body = route.request().postDataJSON()
    return route.fulfill({ json: 'new-question-id' })
  })
  await page.getByRole('button', { name: 'Save to Question Library' }).click()
  await expect(page.getByRole('status')).toContainText('Question Library changes saved')
  expect(body).toMatchObject({ p_question_id: null, p_expected_revision: null, p_verified: false, p_question: { status: 'draft', correct_answer: 'Mercury', audience_fit: 'broad', adult_content: false } })
})

test('super-admin explicitly confirms access and gets saved feedback', async ({ page }, testInfo) => {
  await mockAdmin(page, 'super_admin')
  await page.getByRole('button', { name: 'Users & access', exact: true }).click()
  await page.getByRole('button', { name: 'Manage access' }).click()
  await expect(page.getByRole('button', { name: 'Save access' })).toBeDisabled()
  await page.getByLabel('Account role').selectOption('admin')
  await page.screenshot({ path: testInfo.outputPath('manage-access.png') })
  let requests = 0
  await page.route('**/rest/v1/rpc/admin_set_user_role', route => {
    requests++
    expect(route.request().postDataJSON()).toEqual({ p_user_id: otherId, p_role: 'admin', p_expected_role: 'host' })
    return route.fulfill({ status: 204, body: '' })
  })
  await page.getByRole('button', { name: 'Save access' }).click()
  await expect(page.getByRole('status')).toContainText('access changed to Admin')
  expect(requests).toBe(1)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

const question = {
  id: '00000000-0000-4000-8000-000000000003', origin: 'platform', owner_id: null,
  question_type: 'single-answer', mechanic: 'single-answer', prompt: 'Original library prompt',
  correct_answer: 'Mercury', accepted_answers: [], options: null, primary_category_id: null,
  secondary_category_ids: [], category_ids: [], category_names: [], tag_ids: [], tag_names: [],
  editorial_difficulty: 3, stability: 'stable', audience_suitability: 'general', audience_scope: 'global',
  audience_locale: null, content_flags: [], image_url: null, notes: null, status: 'active', revision: 7,
  is_verified: true, bonus: null, audience_fit: 'broad', adult_content: false,
}

test('library editing sends revision and preserves a rejected draft', async ({ page }) => {
  await mockAdmin(page, 'admin')
  await page.route('**/rest/v1/source_question_catalog**', route => route.fulfill({ json: [question], headers: { 'content-range': '0-0/1' } }))
  await page.getByRole('button', { name: 'Question Library', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Question text', exact: true }).fill('Edited prompt')
  await page.getByLabel('Library status').selectOption('archived')
  await page.route('**/rest/v1/rpc/admin_save_library_question', route => {
    expect(route.request().postDataJSON()).toMatchObject({ p_expected_revision: 7, p_question: { prompt: 'Edited prompt', status: 'archived' } })
    return route.fulfill({ status: 400, json: { message: 'This question changed since you opened it. Close the editor, refresh and try again.', code: 'P0001' } })
  })
  await page.getByRole('button', { name: 'Save to Question Library' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'changed since you opened it' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Question text', exact: true })).toHaveValue('Edited prompt')
  await expect(page.getByRole('button', { name: 'Save to Question Library' })).toBeEnabled()
})

test('question search resets pagination and reports full matching count', async ({ page }, testInfo) => {
  await mockAdmin(page, 'admin')
  const offsets: string[] = []
  await page.route('**/rest/v1/source_question_catalog**', route => {
    offsets.push(new URL(route.request().url()).searchParams.get('offset') ?? '0')
    return route.fulfill({ json: [question], headers: { 'content-range': '0-0/101', 'access-control-expose-headers': 'content-range' } })
  })
  await page.getByRole('button', { name: 'Question Library', exact: true }).click()
  await expect(page.getByText('101 questions', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('library.png'), fullPage: true })
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect.poll(() => offsets.at(-1)).toBe('50')
  await page.getByPlaceholder('Search question, answer, category, or topic…').fill('Mercury')
  await expect.poll(() => offsets.at(-1)).toBe('0')
})
