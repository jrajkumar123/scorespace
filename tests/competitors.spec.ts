import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

test('adding a competitor requires authentication', async ({ request }) => {
  const response = await request.post('/api/actions/addCompetitor', {
    data: { name: 'Ada', competitionId: 'unknown' },
  })
  expect(response.status()).toBe(401)
})

async function openNewCompetition(page: Page) {
  const name = `Competition ${crypto.randomUUID()}`
  await page.goto('/home')
  await page.getByRole('button', { name: 'Create Competition', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Competition name').fill(name)
  await dialog.getByRole('button', { name: 'Create Competition', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByText('No competitors yet', { exact: true })).toBeVisible()
  return page.url()
}

test('competitors sync, persist, stay with one competition, and reject another owner', async ({ users }) => {
  test.skip(loadAllTestAccounts().length < 2, 'Needs two usable DeepSpace test accounts.')
  const [owner, other] = await users(2)
  const url = await openNewCompetition(owner.page)
  const secondTab = await owner.context.newPage()
  await secondTab.goto(url)
  await expect(secondTab.getByText('No competitors yet', { exact: true })).toBeVisible()

  await owner.page.getByRole('button', { name: 'Add Competitor', exact: true }).click()
  const dialog = owner.page.getByRole('dialog')
  await dialog.getByLabel('Competitor name').fill('   ')
  await expect(dialog.getByRole('button', { name: 'Add Competitor', exact: true })).toBeDisabled()
  const name = `Competitor ${crypto.randomUUID()}`
  await dialog.getByLabel('Competitor name').fill(`  ${name}  `)
  await dialog.getByRole('button', { name: 'Add Competitor', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(owner.page.getByRole('listitem').filter({ hasText: name })).toHaveText(name)
  await expect(secondTab.getByRole('listitem').filter({ hasText: name })).toHaveText(name)
  await owner.page.reload()
  await expect(owner.page.getByRole('listitem').filter({ hasText: name })).toHaveText(name)
  await owner.page.getByRole('link', { name: 'Back to dashboard' }).click()
  await expect(owner.page).toHaveURL(/\/home$/)
  await openNewCompetition(owner.page)
  await expect(owner.page.getByText(name, { exact: true })).toHaveCount(0)

  await other.page.goto(url)
  await expect(other.page.getByText('Competition not found or unavailable.', { exact: true })).toBeVisible()
  await expect(other.page.getByRole('button', { name: 'Add Competitor', exact: true })).toHaveCount(0)
  await openNewCompetition(other.page)
  // Tamper with a real authenticated request: the server must reject the foreign parent.
  await other.page.route('**/api/actions/addCompetitor', async (route) => {
    await route.continue({ postData: JSON.stringify({
      ...route.request().postDataJSON(), competitionId: decodeURIComponent(new URL(url).pathname.split('/').pop()!),
    }) })
  })
  await other.page.getByRole('button', { name: 'Add Competitor', exact: true }).click()
  await other.page.getByLabel('Competitor name').fill('Unauthorized competitor')
  await other.page.getByRole('dialog').getByRole('button', { name: 'Add Competitor', exact: true }).click()
  await expect(other.page.getByRole('alert').filter({ hasText: 'Competition not found or unavailable.' })).toBeVisible()
  await expect(other.page.getByLabel('Competitor name')).toHaveValue('Unauthorized competitor')
  await secondTab.reload()
  await expect(secondTab.getByRole('listitem').filter({ hasText: name })).toHaveText(name)
  await expect(secondTab.getByText('Unauthorized competitor', { exact: true })).toHaveCount(0)
})
