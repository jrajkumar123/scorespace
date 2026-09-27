import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

test('live results route requires sign-in', async ({ page }) => {
  await page.goto('/competitions/missing/results')
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
})

async function createCompetition(page: Page) {
  const name = `Results ${crypto.randomUUID()}`
  await page.goto('/home')
  await page.getByRole('button', { name: 'Create Competition', exact: true }).click()
  await page.getByLabel('Competition name').fill(name)
  await page.getByRole('dialog').getByRole('button', { name: 'Create Competition', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  return { name, url: page.url() }
}

async function addCompetitor(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add Competitor', exact: true }).click()
  await page.getByLabel('Competitor name').fill(name)
  await page.getByRole('dialog').getByRole('button', { name: 'Add Competitor', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: name }).getByText(name, { exact: true })).toHaveText(name)
}

async function submitScore(page: Page, name: string, value: string) {
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) })
  await row.getByLabel(`Score for ${name}`).fill(value)
  await row.getByRole('button', { name: 'Submit Score' }).click()
  await expect(row.getByText(`Your submitted score: ${value} / 10`, { exact: true })).toBeVisible()
}

async function expectStandings(page: Page, expected: string[][]) {
  const rows = page.getByRole('table', { name: 'Competition standings' }).locator('tbody tr')
  await expect(rows).toHaveCount(expected.length)
  for (let index = 0; index < expected.length; index++) {
    await expect(rows.nth(index).locator('th, td')).toHaveText([...expected[index], expected[index][2] === 'Not scored' ? '0' : '1'])
  }
}

test('standings update from another tab, preserve ties and unscored entries, and survive reload', async ({ users }) => {
  test.skip(loadAllTestAccounts().length < 1, 'Needs one usable DeepSpace test account.')
  const [owner] = await users(1)
  const competition = await createCompetition(owner.page)
  await owner.page.getByRole('link', { name: 'Live Results', exact: true }).click()
  await expect(owner.page.getByRole('heading', { name: 'Live Results', exact: true })).toBeVisible()
  await expect(owner.page.getByRole('heading', { name: competition.name, exact: true })).toBeVisible()
  await expect(owner.page.getByText('No competitors yet', { exact: true })).toBeVisible()
  const resultsUrl = owner.page.url()
  const judging = await owner.context.newPage()
  await judging.goto(competition.url)
  // The already-open results page must also receive new competitors.
  for (const name of ['Dana', 'Clara', 'Bob', 'Ada']) await addCompetitor(judging, name)
  await expectStandings(owner.page, ['Ada', 'Bob', 'Clara', 'Dana'].map((name) => ['—', name, 'Not scored']))
  await judging.getByRole('link', { name: 'Judge Competition', exact: true }).click()
  await submitScore(judging, 'Ada', '8.25')
  await expectStandings(owner.page, [['1', 'Ada', '8.25'], ['—', 'Bob', 'Not scored'], ['—', 'Clara', 'Not scored'], ['—', 'Dana', 'Not scored']])
  await submitScore(judging, 'Clara', '9.5')
  await expectStandings(owner.page, [['1', 'Clara', '9.5'], ['2', 'Ada', '8.25'], ['—', 'Bob', 'Not scored'], ['—', 'Dana', 'Not scored']])
  await submitScore(judging, 'Bob', '9.5')
  const final = [['1 (tie)', 'Bob', '9.5'], ['1 (tie)', 'Clara', '9.5'], ['3', 'Ada', '8.25'], ['—', 'Dana', 'Not scored']]
  await expectStandings(owner.page, final)
  // Everything above was observed without navigation or refresh in the results tab.
  await expect(owner.page).toHaveURL(resultsUrl)
  await owner.page.reload()
  await expectStandings(owner.page, final)
  await owner.page.getByRole('link', { name: 'Back to competition' }).click()
  await expect(owner.page).toHaveURL(competition.url)
  const second = await createCompetition(owner.page)
  await owner.page.getByRole('link', { name: 'Live Results', exact: true }).click()
  await expect(owner.page.getByRole('heading', { name: second.name, exact: true })).toBeVisible()
  await expect(owner.page.getByText('No competitors yet', { exact: true })).toBeVisible()
  await expect(owner.page.getByRole('table')).toHaveCount(0)
})

test('results do not expose another owner’s competition or scores', async ({ users }) => {
  test.skip(loadAllTestAccounts().length < 2, 'Needs two usable DeepSpace test accounts.')
  const [owner, other] = await users(2)
  const competition = await createCompetition(owner.page)
  await addCompetitor(owner.page, 'Private competitor')
  await owner.page.getByRole('link', { name: 'Judge Competition' }).click()
  await submitScore(owner.page, 'Private competitor', '8.25')
  await other.page.goto(`${competition.url}/results`)
  await expect(other.page.getByText('Competition not found or unavailable.', { exact: true })).toBeVisible()
  await expect(other.page.getByRole('table')).toHaveCount(0)
  await expect(other.page.getByText(competition.name, { exact: true })).toHaveCount(0)
  await expect(other.page.getByText('Private competitor', { exact: true })).toHaveCount(0)
  await other.page.goto('/competitions/missing/results')
  await expect(other.page.getByText('Competition not found or unavailable.', { exact: true })).toBeVisible()
})
