import { Hono } from 'hono'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ActionContext, VerifyResult } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker'
import { registerActionRoutes } from './action-routes'

vi.mock('../actions/index.js', () => ({ actions: {
  testAction: async ({ userId, tools }: ActionContext<Env>) => tools.create('test', { verifiedCaller: userId }),
} }))
let app: Hono<AppContext>
let auth: ReturnType<typeof vi.fn<() => Promise<VerifyResult | null>>>
let roomFetch: ReturnType<typeof vi.fn>
let env: Env
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  auth = vi.fn<() => Promise<VerifyResult | null>>().mockResolvedValue({ userId: 'verified-user' } as VerifyResult)
  roomFetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { recordId: 'test-record' } }))
  env = { DEEPSPACE_APP_ID: 'test-app', APP_OWNER_JWT: 'fake-environment-sentinel',
    RECORD_ROOMS: { idFromName: (name: string) => name, get: () => ({ fetch: roomFetch }) },
  } as unknown as Env
  app = new Hono<AppContext>()
  registerActionRoutes(app, auth)
})
afterEach(() => vi.restoreAllMocks())
const request = (name: string, body = '{}', authorization = 'Bearer fake-caller-token') => app.request(`/api/actions/${name}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization, 'X-User-Id': 'forged' }, body,
}, env)

it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'missing'])('rejects unregistered/inherited action %s without exposing context', async (name) => {
  const response = await request(name)
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Action not found' })
  expect(roomFetch).not.toHaveBeenCalled()
})
it('rejects failed authentication before dispatch', async () => {
  auth.mockResolvedValue(null)
  expect((await request('testAction')).status).toBe(401)
  expect(roomFetch).not.toHaveBeenCalled()
})
it('rejects missing bearer credentials', async () => {
  expect((await request('testAction', '{}', '')).status).toBe(401)
  expect(roomFetch).not.toHaveBeenCalled()
})
it.each(['{', 'null', '[]', '"text"'])('rejects malformed or non-object request bodies: %s', async (body) => {
  expect((await request('testAction', body)).status).toBe(400)
  expect(roomFetch).not.toHaveBeenCalled()
})
it('registered actions use verified identity, never browser identity or internal headers', async () => {
  const response = await request('testAction', '{"userId":"forged","createdBy":"forged"}')
  expect(response.status).toBe(200)
  const internal = roomFetch.mock.calls[0][0] as Request
  expect(internal.headers.get('X-User-Id')).toBe('verified-user')
  expect(await internal.json()).toMatchObject({ tool: 'records.create', params: { data: { verifiedCaller: 'verified-user' } } })
  expect(await response.json()).toEqual({ success: true, data: { recordId: 'test-record' } })
})
