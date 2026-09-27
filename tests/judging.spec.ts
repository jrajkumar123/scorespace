import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

test('score submission requires authentication', async ({ request }) => {
  const response = await request.post('/api/actions/submitScore', {
    data: { competitionId: 'a', competitorId: 'b', value: 8.25 },
  })
  expect(response.status()).toBe(401)
})

test('judging route uses the protected layout', async ({ page }) => {
  await page.goto('/competitions/missing/judge')
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit Score' })).toHaveCount(0)
})

async function prepareJudging(page: Page) {
  const competition = `Judging ${crypto.randomUUID()}`
  await page.goto('/home')
  await page.getByRole('button', { name: 'Create Competition', exact: true }).click()
  await page.getByLabel('Competition name').fill(competition)
  await page.getByRole('dialog').getByRole('button', { name: 'Create Competition', exact: true }).click()
  await page.getByRole('link', { name: competition, exact: true }).click()
  await page.getByRole('button', { name: 'Add Competitor', exact: true }).click()
  await page.getByLabel('Competitor name').fill('Ada')
  await page.getByRole('dialog').getByRole('button', { name: 'Add Competitor', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Ada' }).getByText('Ada', { exact: true })).toHaveText('Ada')
  await page.getByRole('link', { name: 'Judge Competition' }).click()
  await expect(page.getByRole('heading', { name: `Judge ${competition}`, exact: true })).toBeVisible()
  await expect(page.getByLabel('Score for Ada')).toBeVisible()
  return page.url()
}

test('scores persist and sync; concurrent values cannot overwrite; foreign owners are rejected', async ({ users }) => {
  test.skip(loadAllTestAccounts().length < 2, 'Needs two usable DeepSpace test accounts.')
  const [owner, other] = await users(2)
  const judgingUrl = await prepareJudging(owner.page)
  const secondTab = await owner.context.newPage()
  await secondTab.goto(judgingUrl)
  await expect(secondTab.getByLabel('Score for Ada')).toBeVisible()
  await owner.page.getByLabel('Score for Ada').fill('10.1')
  await expect(owner.page.getByRole('button', { name: 'Submit Score' })).toBeDisabled()

  let acceptedValue = 0
  let foreignTarget: { competitionId: string; competitorId: string } | undefined
  await owner.page.route('**/api/actions/submitScore', async (route) => {
    const payload = route.request().postDataJSON()
    foreignTarget = { competitionId: payload.competitionId, competitorId: payload.competitorId }
    // Race two real requests through the authenticated worker and RecordRoom.
    const responses = await Promise.all([8.25, 9.5].map((value) => owner.context.request.post('/api/actions/submitScore', {
      headers: route.request().headers(), data: { ...payload, value },
    })))
    const results = await Promise.all(responses.map((response) => response.json()))
    expect(results.filter((result) => result.success)).toHaveLength(1)
    const winner = results.findIndex((result) => result.success)
    acceptedValue = [8.25, 9.5][winner]
    // Retrying the winning value acknowledges the same record; the loser stays rejected.
    const retry = await owner.context.request.post('/api/actions/submitScore', {
      headers: route.request().headers(), data: { ...payload, value: acceptedValue },
    })
    expect((await retry.json()).success).toBe(true)
    await route.fulfill({ response: responses[winner] })
  })
  await owner.page.getByLabel('Score for Ada').fill('8.25')
  await owner.page.getByRole('button', { name: 'Submit Score' }).click()
  await expect(owner.page.getByText('Your submitted score:', { exact: false })).toBeVisible()
  await expect(secondTab.getByText(`Your submitted score: ${acceptedValue} / 10`, { exact: true })).toBeVisible()
  await owner.page.reload()
  await expect(owner.page.getByText(`Your submitted score: ${acceptedValue} / 10`, { exact: true })).toBeVisible()
  await expect(owner.page.getByRole('button', { name: 'Submit Score' })).toHaveCount(0)
  await owner.page.getByRole('link', { name: 'Back to competition' }).click()
  await expect(owner.page.getByRole('link', { name: 'Judge Competition' })).toBeVisible()

  await other.page.goto(judgingUrl)
  await expect(other.page.getByText('Competition not found or unavailable.', { exact: true })).toBeVisible()
  await prepareJudging(other.page)
  await other.page.route('**/api/actions/submitScore', async (route) => {
    expect(foreignTarget).toBeDefined()
    await route.continue({ postData: JSON.stringify({ ...foreignTarget, value: 10 }) })
  })
  await other.page.getByLabel('Score for Ada').fill('10')
  await other.page.getByRole('button', { name: 'Submit Score' }).click()
  await expect(other.page.getByRole('alert')).toHaveText('Competition or competitor not found or unavailable.')
  await secondTab.reload()
  await expect(secondTab.getByText(`Your submitted score: ${acceptedValue} / 10`, { exact: true })).toBeVisible()
})
