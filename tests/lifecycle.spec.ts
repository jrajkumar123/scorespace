import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test('lifecycle internal route is not exposed by the worker', async ({ request }) => {
  const response = await request.post('/internal/lifecycle', {
    headers: { 'X-App-Action': 'true', 'X-User-Id': 'forged' },
    data: { operation: 'deleteCompetition', competitionId: 'missing' },
  })
  expect(response.ok()).toBe(false)
})

test('organizer revokes judging, removes scored competitors, and deletes live published competition', async ({ users, page }) => {
  test.skip(loadAllTestAccounts().length < 2, 'Needs two usable DeepSpace test accounts.')
  const [owner, judge] = await users(2)
  const name = `Lifecycle ${crypto.randomUUID()}`
  await judge.page.goto('/home')
  await owner.page.goto('/home')
  await owner.page.getByRole('button', { name: 'Create Competition', exact: true }).click()
  await owner.page.getByLabel('Competition name').fill(name)
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Create Competition', exact: true }).click()
  await owner.page.getByRole('link', { name, exact: true }).click()
  const url = owner.page.url()
  for (const competitor of ['Ada', 'Bob']) {
    await owner.page.getByRole('button', { name: 'Add Competitor', exact: true }).click()
    await owner.page.getByLabel('Competitor name').fill(competitor)
    await owner.page.getByRole('dialog').getByRole('button', { name: 'Add Competitor', exact: true }).click()
    await expect(owner.page.getByRole('dialog')).not.toBeVisible()
  }
  await owner.page.getByLabel('Existing user').selectOption(judge.userId)
  await owner.page.getByRole('button', { name: 'Add Judge', exact: true }).click()
  await expect(owner.page.getByRole('list', { name: 'Authorized judges' })).toContainText(judge.userId)
  await owner.page.getByRole('button', { name: 'Enable Public Results', exact: true }).click()
  await page.goto(await owner.page.getByLabel('Public results URL').inputValue())
  const publicRows = page.getByRole('list', { name: 'Live leaderboard' }).getByRole('listitem')
  await expect(publicRows).toHaveCount(2)
  await judge.page.goto(`${url}/judge`)
  for (const control of ['Remove Judge', 'Remove Competitor', 'Delete Competition']) {
    await expect(judge.page.getByRole('button', { name: control, exact: true })).toHaveCount(0)
  }
  let scoreHeaders: Record<string, string> = {}
  let scoreBody: Record<string, unknown> = {}
  await judge.page.route('**/api/actions/submitScore', async (route) => {
    scoreHeaders = route.request().headers()
    scoreBody = route.request().postDataJSON()
    for (const [action, data] of [
      ['removeJudge', { competitionId: scoreBody.competitionId, judgeId: judge.userId }],
      ['removeCompetitor', { competitionId: scoreBody.competitionId, competitorId: scoreBody.competitorId }],
      ['deleteCompetition', { competitionId: scoreBody.competitionId }],
    ] as const) {
      const response = await judge.context.request.post(`/api/actions/${action}`, { headers: scoreHeaders, data })
      expect((await response.json()).success).toBe(false)
    }
    await route.continue()
  })
  await judge.page.getByLabel('Score for Ada').fill('9')
  await judge.page.getByRole('listitem').filter({ has: judge.page.getByRole('heading', { name: 'Ada', exact: true }) }).getByRole('button', { name: 'Submit Score' }).click()
  await expect(publicRows.filter({ hasText: 'Ada' })).toContainText('9.0 / 10')
  const dashboard = await judge.context.newPage()
  await dashboard.goto('/home')
  await expect(dashboard.getByRole('link', { name: new RegExp(name) })).toBeVisible()
  const results = await owner.context.newPage()
  await results.goto(`${url}/results`)

  await owner.page.getByRole('button', { name: 'Remove Judge', exact: true }).click()
  await expect(owner.page.getByRole('dialog')).toContainText('preserved')
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Remove Judge', exact: true }).click()
  await expect(dashboard.getByRole('link', { name: new RegExp(name) })).toHaveCount(0)
  await expect(judge.page.getByText('Competition not found or unavailable.', { exact: true })).toBeVisible()
  const revoked = await judge.context.request.post('/api/actions/submitScore', { headers: scoreHeaders, data: scoreBody })
  expect((await revoked.json()).success).toBe(false)
  await expect(publicRows.filter({ hasText: 'Ada' })).toContainText('9.0 / 10')
  await expect(results.getByRole('table').locator('tbody tr').filter({ hasText: 'Ada' })).toContainText('9.0')

  const ada = owner.page.getByRole('list', { name: 'Competitors', exact: true }).getByRole('listitem').filter({ hasText: 'Ada' })
  await ada.getByRole('button', { name: 'Remove Competitor', exact: true }).click()
  await expect(owner.page.getByRole('dialog')).toContainText('all scores')
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(ada).toBeVisible()
  await ada.getByRole('button', { name: 'Remove Competitor', exact: true }).click()
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Remove Competitor', exact: true }).click()
  await expect(publicRows).toHaveCount(1)
  await expect(publicRows.first()).toContainText('Bob')
  await expect(results.getByRole('table').locator('tbody tr').filter({ hasText: 'Ada' })).toHaveCount(0)

  await owner.page.getByRole('button', { name: 'Delete Competition', exact: true }).click()
  const dialog = owner.page.getByRole('dialog')
  await expect(dialog).toContainText(name)
  await expect(dialog.getByRole('button', { name: 'Delete Competition', exact: true })).toBeDisabled()
  await dialog.getByLabel('Type the competition name to confirm').fill(name)
  await dialog.getByRole('button', { name: 'Delete Competition', exact: true }).click()
  await expect(owner.page).toHaveURL(/\/home$/)
  await expect(owner.page.getByRole('link', { name, exact: true })).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Public results are unavailable.')
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Public results are unavailable.')
})
