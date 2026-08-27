import { expect, test } from '@playwright/test'

const hostEmail = process.env.E2E_HOST_EMAIL
const hostPassword = process.env.E2E_HOST_PASSWORD
const quizTitle = process.env.E2E_QUIZ_TITLE

test.skip(!hostEmail || !hostPassword || !quizTitle, 'Requires a dedicated E2E host and disposable ready quiz')

test('dedicated test host can open a lobby and a player can reach team setup', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const playerContext = await browser.newContext()
  const host = await hostContext.newPage()
  const player = await playerContext.newPage()
  let lobbyCreated = false

  try {
    await host.goto('/host')
    await host.getByLabel('Email').fill(hostEmail as string)
    await host.getByLabel('Password').fill(hostPassword as string)
    await host.getByRole('button', { name: 'Sign in' }).click()
    await expect(host.getByRole('heading', { name: 'My Quizzes' })).toBeVisible()

    const quizCard = host.locator('div.rounded-2xl').filter({ has: host.getByRole('heading', { name: quizTitle as string }) }).first()
    await quizCard.getByRole('button', { name: 'Host Game' }).click()
    await host.getByRole('button', { name: /Open Fresh Lobby/ }).click()

    const joinCodeControl = host.getByRole('button', { name: /Join code \d{6}/ })
    await expect(joinCodeControl).toBeVisible()
    const accessibleName = await joinCodeControl.getAttribute('aria-label')
    const code = accessibleName?.match(/\d{6}/)?.[0]
    expect(code).toBeTruthy()
    lobbyCreated = true

    await player.goto(`/play?code=${code}`)
    await expect(player.getByText('Game found')).toBeVisible()
    await expect(player.getByRole('heading', { name: "What’s your team name?" })).toBeVisible()

    const teamName = `Browser Test ${Date.now()}`
    await player.getByLabel('Team name').fill(teamName)
    await player.getByRole('button', { name: 'Join Game' }).click()
    await expect(player.getByRole('heading', { name: 'You’re in!' })).toBeVisible()
    await expect(host.getByText(teamName, { exact: true })).toBeVisible()
  } finally {
    if (lobbyCreated) {
      const cancelButton = host.getByRole('button', { name: 'Cancel game', exact: true }).first()
      if (await cancelButton.isVisible()) {
        await cancelButton.click()
        await host.getByRole('button', { name: 'Cancel game', exact: true }).last().click()
        await expect(host.getByRole('button', { name: 'Create Quiz' })).toBeVisible()
      }
    }
    await playerContext.close()
    await hostContext.close()
  }
})
