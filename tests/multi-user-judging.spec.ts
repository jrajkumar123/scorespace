import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test('assigned judge joins live, scores privately, and updates organizer averages', async ({ users }) => {
  test.skip(loadAllTestAccounts().length < 2, 'Needs two usable DeepSpace test accounts.')
  const [owner, judge] = await users(2)
  const name = `Multi-user ${crypto.randomUUID()}`
  await judge.page.goto('/home')
  await owner.page.goto('/home')
  await owner.page.getByRole('button', { name: 'Create Competition', exact: true }).click()
  await owner.page.getByLabel('Competition name').fill(name)
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Create Competition', exact: true }).click()
  await expect(owner.page.getByRole('link', { name, exact: true })).toHaveAttribute('href', /\/competitions\/[^/]+$/)
  await owner.page.getByRole('link', { name, exact: true }).click()
  const url = owner.page.url()
  await owner.page.getByRole('button', { name: 'Add Competitor', exact: true }).click()
  await owner.page.getByLabel('Competitor name').fill('Ada')
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Add Competitor', exact: true }).click()
  await expect(owner.page.getByRole('dialog')).not.toBeVisible()
  await expect(judge.page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0)
  await judge.page.goto(url)
  await expect(judge.page.getByText('Competition not found or unavailable.', { exact: true })).toBeVisible()
  await judge.page.goto('/home')

  await owner.page.getByLabel('Existing user').selectOption(judge.userId)
  await owner.page.getByRole('button', { name: 'Add Judge', exact: true }).click()
  await expect(owner.page.getByRole('list', { name: 'Authorized judges' })).toContainText(judge.userId)
  // No reload or navigation in the judge's existing dashboard before this assertion.
  await expect(judge.page.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', /\/judge$/)
  await judge.page.getByRole('link', { name: new RegExp(name) }).click()
  await expect(judge.page).toHaveURL(`${url}/judge`)
  await expect(judge.page.getByLabel('Score for Ada')).toBeVisible()
  await judge.page.getByRole('link', { name: 'Back to dashboard' }).click()
  await expect(judge.page).toHaveURL(/\/home$/)
  // Direct access replaces the organizer shell with the useful judging route.
  await judge.page.goto(url)
  await expect(judge.page).toHaveURL(`${url}/judge`)
  await expect(judge.page.getByLabel('Score for Ada')).toBeVisible()
  await expect(judge.page.getByRole('button', { name: 'Add Competitor' })).toHaveCount(0)
  await expect(judge.page.getByRole('button', { name: 'Add Judge' })).toHaveCount(0)
  await expect(judge.page.getByRole('link', { name: 'Live Results' })).toHaveCount(0)
  await judge.page.goto(`${url}/results`)
  await expect(judge.page.getByText('Competition not found or unavailable.', { exact: true })).toBeVisible()
  await expect(judge.page.getByRole('table')).toHaveCount(0)
  await judge.page.goto(`${url}/judge`)

  await owner.page.getByRole('link', { name: 'Judge Competition' }).click()
  await owner.page.getByLabel('Score for Ada').fill('8')
  await owner.page.getByRole('button', { name: 'Submit Score' }).click()
  await expect(owner.page.getByText('Your submitted score: 8.0 / 10', { exact: true })).toBeVisible()
  // Owner's accepted score must not replace this judge's empty form.
  await expect(judge.page.getByLabel('Score for Ada')).toBeVisible()
  const results = await owner.context.newPage()
  await results.goto(`${url}/results`)
  const row = results.getByRole('table').locator('tbody tr')
  await expect(row.locator('th, td')).toHaveText(['1', 'Ada', '8.0', '1'])

  await judge.page.route('**/api/actions/submitScore', async (route) => {
    const body = route.request().postDataJSON()
    const headers = route.request().headers()
    // A real authenticated judge must be denied organizer actions server-side.
    for (const [action, data] of [
      ['addCompetitor', { competitionId: body.competitionId, name: 'Forged' }],
      ['addJudge', { competitionId: body.competitionId, judgeId: owner.userId }],
    ] as const) {
      const response = await judge.context.request.post(`/api/actions/${action}`, { headers, data })
      expect((await response.json()).success).toBe(false)
    }
    await route.continue({ postData: JSON.stringify({ ...body, judgeId: owner.userId, userId: owner.userId, recordId: 'forged' }) })
  })
  await judge.page.getByLabel('Score for Ada').fill('9.5')
  await judge.page.getByRole('button', { name: 'Submit Score' }).click()
  await expect(judge.page.getByText('Your submitted score: 9.5 / 10', { exact: true })).toBeVisible()
  await expect(row.locator('th, td')).toHaveText(['1', 'Ada', '8.75', '2'])
  await expect(owner.page.getByText('Your submitted score: 8.0 / 10', { exact: true })).toBeVisible()
  await judge.page.reload()
  await expect(judge.page.getByText('Your submitted score: 9.5 / 10', { exact: true })).toBeVisible()
  await expect(judge.page.getByRole('button', { name: 'Submit Score' })).toHaveCount(0)
  await results.reload()
  await expect(row.locator('th, td')).toHaveText(['1', 'Ada', '8.75', '2'])
})
