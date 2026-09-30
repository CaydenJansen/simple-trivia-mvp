import { expect, test, type Page } from '@playwright/test'

async function answers(page: Page, mechanic = 'single-answer', hidden = false) {
  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'feedback-game')
    localStorage.setItem('simple-trivia-team-id', 'feedback-team')
    localStorage.setItem('simple-trivia-join-request-id', 'request')
    localStorage.setItem('simple-trivia-join-request-token', 'token')
  })
  const compound = ['multi-answer', 'multi-part', 'ranking'].includes(mechanic)
  const expected = 'A complete expected answer that must remain readable on a narrow phone screen'
  const submitted = 'A complete submitted answer that must remain readable on a narrow phone screen'
  const state = {
    phase: 'revealed', correct: false, bonus: false,
    answer: compound ? JSON.stringify([submitted, 'Second submitted answer']) : submitted,
    saved: true,
  }
  await page.route('**/rest/v1/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name === 'get_team_join_request') return route.fulfill({ json: { admission_status: 'approved', team_id: 'feedback-team', name: 'Feedback team', game_status: 'live' } })
    if (name === 'get_server_epoch_ms') return route.fulfill({ json: Date.now() })
    if (name === 'games') return route.fulfill({ json: { id: 'feedback-game', status: 'live', current_screen: mechanic, current_question_key: 'q1', answer_phase: state.phase, question_stage: 'core', answer_editing_allowed: true, settings: { player_score_visibility: hidden ? 'hidden' : 'live', show_correctness_percentage_to_players: true } } })
    if (name === 'get_player_game_question') return route.fulfill({ json: { question_key: 'q1', round_number: 1, round_position: 1, round_question_count: 1, prompt: 'Answer feedback fixture', question_type: mechanic, points_max: compound ? 2 : 1, options: mechanic === 'ranking' ? ['One', 'Two'] : mechanic === 'multiple-choice' ? [{ key: 'A', label: 'First choice' }, { key: 'B', label: 'Second choice' }] : [{ label: 'A', clue: 'First clue' }, { label: 'B', clue: 'Second clue' }], correct_answer: compound ? [expected, 'Second expected answer'] : expected, bonus: state.bonus ? { prompt: 'Bonus', correct_answer: 'Bonus correct', points: 1 } : null } })
    if (name === 'teams') return route.fulfill({ json: { id: 'feedback-team', game_id: 'feedback-game', name: 'Feedback team', score: state.correct ? (compound ? 2 : 1) : 0 } })
    if (name === 'get_player_question_accuracy') return route.fulfill({ json: { total: 3, correct: 0, percentage: 0, items: [{ total: 3, correct: 1, percentage: 33 }, { total: 3, correct: 2, percentage: 67 }] } })
    if (name === 'get_owned_player_submission') {
      const bonus = route.request().postDataJSON().p_bonus
      if ((bonus && !state.bonus) || !state.saved) return route.fulfill({ json: null })
      const values = bonus ? ['Bonus submitted'] : compound ? JSON.parse(state.answer) : [state.answer]
      return route.fulfill({ json: { id: 'submission', answer_text: bonus ? 'Bonus submitted' : state.answer, is_correct: state.phase === 'open' ? null : state.correct, points_awarded: !hidden && state.correct ? (compound ? 2 : 1) : 0, grading_json: state.phase === 'open' ? null : { items: values.map((value: string, i: number) => ({ label: String.fromCharCode(65 + i), submitted: value, expected: bonus ? 'Bonus correct' : i ? 'Second expected answer' : expected, status: state.correct ? 'correct' : 'incorrect' })) } } })
    }
    if (name === 'submit_owned_player_answer') {
      state.answer = route.request().postDataJSON().p_answer_text
      state.saved = true
      return route.fulfill({ json: 'submission' })
    }
    return route.fulfill({ json: [] })
  })
  return { state, expected, submitted }
}

for (const mechanic of ['single-answer', 'multi-part', 'multi-answer', 'ranking']) {
  test(`${mechanic}: full answer text and live host overrides in both directions`, async ({ page }, testInfo) => {
    const fixture = await answers(page, mechanic)
    await page.goto('/play')
    await expect(page.getByRole('heading', { name: 'Not quite' })).toBeVisible()
    const answer = page.getByText(fixture.submitted, { exact: true })
    await expect(answer).toBeVisible()
    expect(await answer.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    if (mechanic !== 'multi-answer') await expect(page.getByText(fixture.expected, { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('full-answer.png'), fullPage: true })
    fixture.state.correct = true
    await expect(page.getByRole('heading', { name: 'Correct!', exact: true })).toBeVisible({ timeout: 6000 })
    await expect(page.getByRole('img', { name: 'Incorrect', exact: true })).toHaveCount(0)
    fixture.state.correct = false
    await expect(page.getByRole('heading', { name: 'Not quite' })).toBeVisible({ timeout: 6000 })
  })
}

test('a host-corrected bonus stays correct when points are hidden', async ({ page }) => {
  const { state } = await answers(page, 'single-answer', true)
  state.bonus = true
  state.correct = true
  await page.goto('/play')
  await expect(page.getByRole('heading', { name: 'Correct!', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Incorrect', exact: true })).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Correct', exact: true })).toHaveCount(3)
})

test('saved answer styling persists then clears immediately on editing', async ({ page }) => {
  const { state } = await answers(page)
  state.phase = 'open'
  state.saved = false
  await page.goto('/play')
  const input = page.getByPlaceholder('Type your answer…')
  await input.fill('First answer')
  await page.getByRole('button', { name: 'Submit Answer', exact: true }).click()
  await expect(page.getByText('✓ Answer saved. Any edits need to be submitted again.')).toBeVisible()
  await expect(input).toHaveCSS('background-color', 'rgb(236, 253, 245)')
  await input.fill('Changed answer')
  await expect(page.getByText('Unsaved changes — submit to replace your saved answer.')).toBeVisible()
  await expect(input).not.toHaveCSS('background-color', 'rgb(236, 253, 245)')
  await page.getByRole('button', { name: 'Update Answer', exact: true }).click()
  await expect(page.getByText('✓ Answer saved. Any edits need to be submitted again.')).toBeVisible()
})

test('eliminated SPR teams watch live remaining picks', async ({ page }) => {
  await answers(page)
  let choice = 'rock'
  await page.route('**/rest/v1/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name === 'games') return route.fulfill({ json: { status: 'live', current_screen: 'show-game', current_show_game_key: 'spr', current_question_key: null, settings: {} } })
    if (name === 'get_owned_player_show_game') return route.fulfill({ json: { id: 'spr', show_game_key: 'spr', round_number: 1, title: 'Scissors Paper Rock', game_type: 'scissors-paper-rock', status: 'open', explode_at: new Date(Date.now() + 10000).toISOString(), settings: { round_number: 3, round_phase: 'choosing', eligible_team_ids: ['feedback-team','b','c'], alive_team_ids: ['b','c'], eliminated_team_ids: ['feedback-team'], round_matchups: [{ team_a: 'b', team_b: 'c' }] } } })
    if (name === 'get_owned_player_choices') return route.fulfill({ json: [{ team_id: 'b', choice }, { team_id: 'c', choice: 'paper' }] })
    if (name === 'teams' && !new URL(route.request().url()).searchParams.has('id')) return route.fulfill({ json: [{ id: 'feedback-team', name: 'Feedback team' }, { id: 'b', name: 'Finalist B' }, { id: 'c', name: 'Finalist C' }] })
    return route.fallback()
  })
  await page.goto('/play')
  await expect(page.getByText('You’re out — spectate the remaining matches')).toBeVisible()
  await expect(page.getByLabel('Finalist B picked rock')).toBeVisible()
  choice = 'scissors'
  await expect(page.getByLabel('Finalist B picked scissors')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Scissors', exact: true })).toHaveCount(0)
})

test('rock final disables the other team’s lane and follows their movement', async ({ page }) => {
  await answers(page)
  let otherLane = 1
  await page.route('**/rest/v1/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name === 'games') return route.fulfill({ json: { status: 'live', current_screen: 'show-game', current_show_game_key: 'rock', current_question_key: null, settings: {} } })
    if (name === 'get_owned_player_show_game') return route.fulfill({ json: { id: 'rock', show_game_key: 'rock', round_number: 1, title: 'Dodge the Rock', game_type: 'dodge-the-rock', status: 'open', explode_at: new Date(Date.now() + 10000).toISOString(), settings: { round_number: 3, round_phase: 'choosing', eligible_team_ids: ['feedback-team','b'], alive_team_ids: ['feedback-team','b'], positions: { 'feedback-team': 0, b: otherLane } } } })
    if (name === 'get_owned_player_choices') return route.fulfill({ json: [] })
    if (name === 'teams' && !new URL(route.request().url()).searchParams.has('id')) return route.fulfill({ json: [{ id: 'feedback-team', name: 'Feedback team' }, { id: 'b', name: 'Finalist B' }] })
    return route.fallback()
  })
  await page.goto('/play')
  await expect(page.getByRole('button', { name: 'Move to lane 2' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Move to lane 3' })).toBeEnabled()
  otherLane = 2
  await expect(page.getByRole('button', { name: 'Move to lane 3' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Move to lane 2' })).toBeEnabled()
})
