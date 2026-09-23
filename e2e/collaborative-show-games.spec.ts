import { expect, test, type Page } from '@playwright/test'

type GameType = 'lowest-bidder' | 'deal-or-no-deal' | 'shared-cursor' | 'beat-the-bomb'

async function mockCollaborativeGame(page: Page, type: GameType) {
  await page.addInitScript(() => {
    localStorage.setItem('simple-trivia-game-id', 'collab-game')
    localStorage.setItem('simple-trivia-game-code', '123456')
    localStorage.setItem('simple-trivia-team-id', 'team-a')
    localStorage.setItem('simple-trivia-team-name', 'Purple People')
    localStorage.setItem('simple-trivia-join-request-id', 'request-a')
    localStorage.setItem('simple-trivia-join-request-token', 'token-a')
  })
  const now = Date.now()
  const settings: Record<string, unknown> = {
    eligible_team_ids: ['team-a', 'team-b'], reward_type: 'points', reward_points: 1,
  }
  if (type === 'beat-the-bomb') settings.armed_at = new Date(now - 1_000).toISOString()
  if (type === 'deal-or-no-deal') settings.deal_round = 1
  if (type === 'shared-cursor') Object.assign(settings, {
    cursor_x: 0, cursor_y: 0, cursor_positions: { 'team-a': { x: -1, y: 0 }, 'team-b': { x: 1, y: 0 } },
  })
  const showGame = {
    id: 'show-game-a', show_game_key: 'collab-a', round_number: 1, round_title: 'Games', game_type: type,
    title: type === 'lowest-bidder' ? 'Lowest Bidder' : type === 'deal-or-no-deal' ? 'Deal or No Deal' : type === 'shared-cursor' ? 'Shared Cursor' : 'Beat the Bomb',
    settings, status: 'open' as string, started_at: new Date(now - 1_000).toISOString(), explode_at: new Date(now + 25_000).toISOString(), winner_team_id: null as string | null,
  }
  let ownBid = 7
  let ownCut = false
  let ownDeal = { id: 'case-a', game_show_game_id: 'show-game-a', game_id: 'collab-game', team_id: 'team-a', assigned_value: 83, swaps_used: 0, decision: null as string | null, locked: false, last_outcome: null as string | null, updated_at: new Date(now).toISOString() }
  let failNextPull = false
  let failNextBidResponse = false
  let failNextDealResponse = false
  let failNextBombResponse = false
  let lowestBidMatches = [{ team_name: 'Purple People', bid: 7, is_own: true, is_winner: false }]
  let lastRpcBody: Record<string, unknown> | null = null

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/rpc/get_team_join_request')) return json({ admission_status: 'approved', team_id: 'team-a', name: 'Purple People', game_status: 'live' })
    if (path.endsWith('/rpc/get_own_lowest_bidder_bid')) return json({ id: 'bid-a', game_show_game_id: 'show-game-a', game_id: 'collab-game', team_id: 'team-a', bid: ownBid, submitted_at: new Date(now).toISOString() })
    if (path.endsWith('/rpc/get_lowest_bidder_matching_result')) return json(lowestBidMatches)
    if (path.endsWith('/rpc/submit_lowest_bidder_bid')) {
      lastRpcBody = route.request().postDataJSON() as Record<string, unknown>; ownBid = Number(lastRpcBody.p_bid)
      if (failNextBidResponse) { failNextBidResponse = false; return route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'response lost' }) }) }
      return json({ id: 'bid-a', game_show_game_id: 'show-game-a', game_id: 'collab-game', team_id: 'team-a', bid: ownBid, submitted_at: new Date().toISOString() })
    }
    if (path.endsWith('/rpc/get_own_deal_or_no_deal_state')) return json(ownDeal)
    if (path.endsWith('/rpc/submit_deal_or_no_deal_decision')) {
      lastRpcBody = route.request().postDataJSON() as Record<string, unknown>
      ownDeal = { ...ownDeal, decision: String(lastRpcBody.p_decision), updated_at: new Date().toISOString() }
      if (failNextDealResponse) { failNextDealResponse = false; return route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'response lost' }) }) }
      return json(ownDeal)
    }
    if (path.endsWith('/rpc/get_own_beat_the_bomb_status')) return json(ownCut)
    if (path.endsWith('/rpc/pull_shared_cursor')) {
      lastRpcBody = route.request().postDataJSON() as Record<string, unknown>
      if (failNextPull) { failNextPull = false; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'temporary failure' }) }) }
      return json(showGame)
    }
    if (path.endsWith('/rpc/cut_beat_the_bomb_wire')) {
      lastRpcBody = route.request().postDataJSON() as Record<string, unknown>; ownCut = true
      if (failNextBombResponse) { failNextBombResponse = false; return route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'response lost' }) }) }
      return json(showGame)
    }
    if (path.endsWith('/rpc/touch_team_presence')) return json('team-a')
    if (path.endsWith('/games')) return json({ id: 'collab-game', title: 'Test', status: 'live', current_screen: 'show-game', answer_phase: 'closed', answer_editing_allowed: false, question_stage: 'core', current_question_key: null, current_content_screen_key: null, current_show_game_key: 'collab-a', settings: {} })
    if (path.endsWith('/game_show_games')) return json(showGame)
    if (path.endsWith('/teams')) {
      const teams = [{ id: 'team-a', game_id: 'collab-game', name: 'Purple People', score: 0, last_seen_at: new Date(now).toISOString() }, { id: 'team-b', game_id: 'collab-game', name: 'Quiz Kids', score: 0, last_seen_at: new Date(now).toISOString() }]
      return json(url.searchParams.has('id') ? teams[0] : teams)
    }
    if (path.endsWith('/game_show_game_presses')) return json([])
    return json([])
  })

  return {
    getLastRpcBody: () => lastRpcBody,
    patchShowGame: (patch: Partial<typeof showGame>) => Object.assign(showGame, patch),
    failNextCursorTap: () => { failNextPull = true },
    failNextLowestBidResponse: () => { failNextBidResponse = true },
    failNextDealDecisionResponse: () => { failNextDealResponse = true },
    failNextBombCutResponse: () => { failNextBombResponse = true },
    setLowestBidMatches: (matches: typeof lowestBidMatches) => { lowestBidMatches = matches },
  }
}

test('Lowest Bidder polling does not erase a bid being edited', async ({ page }) => {
  const mock = await mockCollaborativeGame(page, 'lowest-bidder')
  await page.goto('/play')
  const bid = page.getByLabel('Your whole number')
  await expect(bid).toHaveValue('7')
  await bid.fill('42')
  await page.waitForTimeout(1_700)
  await expect(bid).toHaveValue('42')
  await page.getByRole('button', { name: 'Update locked bid' }).click()
  await expect.poll(() => mock.getLastRpcBody()).toMatchObject({ p_bid: 42, p_request_id: 'request-a', p_request_token: 'token-a' })
})

test('Deal or No Deal exposes the secret case and both team decisions', async ({ page }) => {
  await mockCollaborativeGame(page, 'deal-or-no-deal')
  await page.goto('/play')
  await expect(page.getByText('$83')).toBeVisible()
  await expect(page.getByRole('button', { name: 'KEEP' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'SWAP' })).toBeVisible()
})

test('Shared Cursor shows every team and sends an authenticated pull', async ({ page }) => {
  const mock = await mockCollaborativeGame(page, 'shared-cursor')
  await page.goto('/play')
  await expect(page.getByText('Purple People', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Quiz Kids', { exact: true })).toBeVisible()
  await expect(page.getByText('Tap stamina')).toBeVisible()
  await page.getByRole('button', { name: 'Tap to nudge the cursor toward Purple People' }).click()
  await expect.poll(() => mock.getLastRpcBody()).toMatchObject({ p_request_id: 'request-a', p_request_token: 'token-a' })
})

test('Beat the Bomb shows the danger timer and uses the secure wire-cut action', async ({ page }) => {
  const mock = await mockCollaborativeGame(page, 'beat-the-bomb')
  await page.goto('/play')
  await expect(page.getByText(/DANGER · \d+s MAX/i)).toBeVisible()
  await page.getByRole('button', { name: 'CUT THE WIRE' }).click()
  await expect.poll(() => mock.getLastRpcBody()).toMatchObject({ p_game_show_game_id: 'show-game-a', p_request_id: 'request-a', p_request_token: 'token-a' })
  expect(mock.getLastRpcBody()).not.toHaveProperty('p_team_id')
})

test('Beat the Bomb polling recovers a missed realtime result', async ({ page }) => {
  const mock = await mockCollaborativeGame(page, 'beat-the-bomb')
  await page.goto('/play')
  await expect(page.getByRole('button', { name: 'CUT THE WIRE' })).toBeVisible()
  mock.patchShowGame({ status: 'exploded', winner_team_id: 'team-b', explode_at: new Date().toISOString() })
  await expect(page.getByRole('heading', { name: 'The bomb exploded!' })).toBeVisible({ timeout: 3_000 })
})

test('Lowest Bidder reveals teams that duplicated the player bid', async ({ page }) => {
  const mock = await mockCollaborativeGame(page, 'lowest-bidder')
  mock.setLowestBidMatches([
    { team_name: 'Purple People', bid: 7, is_own: true, is_winner: false },
    { team_name: 'Quiz Kids', bid: 7, is_own: false, is_winner: false },
  ])
  mock.patchShowGame({ status: 'exploded', winner_team_id: null, explode_at: new Date().toISOString() })
  await page.goto('/play')
  await expect(page.getByText('Also chose 7')).toBeVisible()
  await expect(page.getByText('Quiz Kids', { exact: true }).last()).toBeVisible()
})

test('Shared Cursor recovers from a transient connection error after a successful retry', async ({ page }) => {
  const mock = await mockCollaborativeGame(page, 'shared-cursor')
  mock.failNextCursorTap()
  await page.goto('/play')
  const tap = page.getByRole('button', { name: 'Tap to nudge the cursor toward Purple People' })
  await tap.click()
  await expect(page.getByText('Connection interrupted. Reconnecting…')).toBeVisible()
  await tap.click()
  await expect(page.getByText('Connection interrupted. Reconnecting…')).toBeHidden()
})

test('Beat the Bomb confirms a cut when the response is lost after saving', async ({ page }) => {
  const mock = await mockCollaborativeGame(page, 'beat-the-bomb')
  mock.failNextBombCutResponse()
  await page.goto('/play')
  await page.getByRole('button', { name: 'CUT THE WIRE' }).click()
  await expect(page.getByRole('heading', { name: 'Wire cut' })).toBeVisible()
  await expect(page.getByText('That press did not go through. Try again.')).toBeHidden()
})

test('Lowest Bidder confirms a saved bid when the response is lost', async ({ page }) => {
  const mock = await mockCollaborativeGame(page, 'lowest-bidder')
  mock.failNextLowestBidResponse()
  await page.goto('/play')
  await page.getByLabel('Your whole number').fill('42')
  await page.getByRole('button', { name: 'Update locked bid' }).click()
  await expect(page.getByText('Your current bid is locked as 42.')).toBeVisible()
  await expect(page.getByText('That bid did not go through. Try again.')).toBeHidden()
})

test('Deal or No Deal confirms a saved decision when the response is lost', async ({ page }) => {
  const mock = await mockCollaborativeGame(page, 'deal-or-no-deal')
  mock.failNextDealDecisionResponse()
  await page.goto('/play')
  await page.getByRole('button', { name: 'SWAP' }).click()
  await expect(page.getByRole('heading', { name: 'Trading with the bank…' })).toBeVisible()
  await expect(page.getByText('That decision did not go through. Try again.')).toBeHidden()
})
