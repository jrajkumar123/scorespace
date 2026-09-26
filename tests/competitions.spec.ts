import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 2, 'Needs two usable DeepSpace test accounts.')

test('competitions persist, synchronize, and stay private to their creator', async ({ users }) => {
  const [owner, other] = await users(2)
  const secondTab = await owner.page.context().newPage()
  await Promise.all([owner.page.goto('/home'), secondTab.goto('/home'), other.page.goto('/home')])
  for (const page of [owner.page, secondTab, other.page]) {
    await expect(page.getByRole('button', { name: 'Create Competition', exact: true })).toBeEnabled()
  }

  const name = `Competition ${crypto.randomUUID()}`
  await owner.page.getByRole('button', { name: 'Create Competition', exact: true }).click()
  const dialog = owner.page.getByRole('dialog')
  await dialog.getByLabel('Competition name').fill('   ')
  await expect(dialog.getByRole('button', { name: 'Create Competition', exact: true })).toBeDisabled()
  await dialog.getByLabel('Competition name').fill(`  ${name}  `)
  await dialog.getByRole('button', { name: 'Create Competition', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(owner.page.getByRole('listitem').filter({ hasText: name })).toHaveText(name)
  // No refresh: the second tab must receive the accepted server broadcast.
  await expect(secondTab.getByRole('listitem').filter({ hasText: name })).toHaveText(name)
  await owner.page.reload()
  await expect(owner.page.getByRole('listitem').filter({ hasText: name })).toHaveText(name)
  // A fresh snapshot for a different identity must not contain the owner's row.
  await other.page.reload()
  await expect(other.page.getByRole('button', { name: 'Create Competition', exact: true })).toBeEnabled()
  await expect(other.page.getByText('Loading competitions…')).not.toBeVisible()
  await expect(other.page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0)
})
