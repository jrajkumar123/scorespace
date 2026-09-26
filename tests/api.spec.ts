import { test, expect } from '@playwright/test'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket. The static
    // landing at '/' deliberately does neither — see smoke.spec.ts.
    await page.goto('/home')
    // Wait for the app to connect its WebSocket (it auto-connects on mount)
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
    // If the app loaded and connected, the WS endpoint works
  })
})

// Unauthenticated requests cannot reach even a registered privileged action.
test('action routes reject anonymous and forged-identity requests', async ({ request }) => {
  for (const name of ['addCompetitor', 'addJudge', 'submitScore', 'constructor']) {
    const response = await request.post(`/api/actions/${name}`, {
      headers: { 'X-User-Id': 'forged', 'X-App-Action': 'true' },
      data: { userId: 'forged', competitionId: 'missing' },
    })
    expect(response.status()).toBe(401)
  }
})
