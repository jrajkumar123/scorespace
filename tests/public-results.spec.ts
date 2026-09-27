import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test('spectators can open the public route without sign-in; unpublished results stay unavailable', async ({ page, request }) => {
  const socketUrls: string[] = []
  page.on('websocket', (socket) => { if (socket.url().includes('/ws/')) socketUrls.push(socket.url()) })
  await page.goto('/live/not-published')
  await expect(page.getByText('LIVE RESULTS', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Public results are unavailable.')
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  expect(socketUrls.length).toBeGreaterThan(0)
  expect(socketUrls.every((url) => !new URL(url).searchParams.has('token'))).toBe(true)
  const response = await request.post('/api/actions/publishResults', {
    headers: { 'X-User-Id': 'forged', 'X-App-Action': 'true' }, data: { competitionId: 'not-published' },
  })
  expect(response.status()).toBe(401)
  // The custom DO route must not be externally reachable, even with forged headers.
  const internal = await request.post('/internal/public-results/publish', {
    headers: { 'X-User-Id': 'forged', 'X-App-Action': 'true' }, data: { competitionId: 'not-published' },
  })
  expect(internal.ok()).toBe(false)
})

test('public scoreboard receives live aggregates but no private score records or judge identities', async ({ users, page }) => {
  test.skip(loadAllTestAccounts().length < 2, 'Needs two usable DeepSpace test accounts.')
  const [owner, judge] = await users(2)
  const name = `Spectator ${crypto.randomUUID()}`
  await judge.page.goto('/home')
  await owner.page.goto('/home')
  await owner.page.getByRole('button', { name: 'Create Competition', exact: true }).click()
  await owner.page.getByLabel('Competition name').fill(name)
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Create Competition', exact: true }).click()
  await owner.page.getByRole('link', { name, exact: true }).click()
  const detailUrl = owner.page.url()
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
  const publicUrl = await owner.page.getByLabel('Public results URL').inputValue()

  const incoming: string[] = []
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/ws/')) return
    expect(new URL(socket.url()).searchParams.has('token')).toBe(false)
    socket.on('framereceived', ({ payload }) => incoming.push(String(payload)))
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(publicUrl)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const rows = page.getByRole('list', { name: 'Live leaderboard' }).getByRole('listitem')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Not scored')
  await expect(page.getByRole('button')).toHaveCount(0)

  await judge.page.goto(`${detailUrl}/judge`)
  await judge.page.getByLabel('Score for Ada').fill('9.5')
  await judge.page.getByRole('listitem').filter({ has: judge.page.getByRole('heading', { name: 'Ada', exact: true }) }).getByRole('button', { name: 'Submit Score' }).click()
  await expect(rows.nth(0)).toContainText('9.5 / 10')
  await expect(rows.nth(0)).toContainText('1 score')
  await owner.page.getByRole('link', { name: 'Judge Competition' }).click()
  await owner.page.getByLabel('Score for Ada').fill('8')
  await owner.page.getByRole('listitem').filter({ has: owner.page.getByRole('heading', { name: 'Ada', exact: true }) }).getByRole('button', { name: 'Submit Score' }).click()
  await expect(rows.nth(0)).toContainText('8.75 / 10')
  await expect(rows.nth(0)).toContainText('2 scores')
  await expect(rows.nth(1)).toContainText('Bob')
  await expect(rows.nth(1)).toContainText('Not scored')
  await expect(page).toHaveURL(publicUrl)

  const wire = incoming.join('\n')
  expect(wire).not.toContain(owner.userId)
  expect(wire).not.toContain(judge.userId)
  expect(wire).not.toContain('organizerAccess')
  expect(wire).not.toContain('"collection":"scores"')
  expect(wire).not.toContain('competitorId')
  await page.reload()
  await expect(rows.nth(0)).toContainText('8.75 / 10')
  // Owner results remain available and use the same arithmetic.
  await owner.page.goto(`${detailUrl}/results`)
  await expect(owner.page.getByRole('table').locator('tbody tr').first()).toContainText('8.75')
})
