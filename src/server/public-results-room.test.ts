// @ts-expect-error node:sqlite is available in supported Node; scaffold omits Node typings.
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolveAppRole, type ActionContext, type ActionResult, type ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { schemas } from '../schemas'
import { PublicResultsRoom } from './public-results-room'
import { publishResults } from '../actions/publish-results'
import { submitScore, scoreRecordId } from '../actions/submit-score'
import { addCompetitor } from '../actions/add-competitor'
import { addJudge } from '../actions/add-judge'
import type { PublicResults } from '../schemas/public-results-schema'

vi.mock('deepspace/worker', async (original) => ({
  ...await original<typeof import('deepspace/worker')>(), resolveAppRole: vi.fn(),
}))
type Row = { recordId: string; createdBy: string; data: Record<string, unknown> }
type Message = { type: string; payload?: { collection?: string; record?: Row } }
let db: { prepare: (sql: string) => { all: (...args: (string | number | null)[]) => Record<string, unknown>[] }; close: () => void }
let room: PublicResultsRoom
let state: DurableObjectState
let durable: Map<string, unknown>
let alarmAt: number | null
let failProjection: boolean
let frames: Record<string, Message[]>
const owner = 'private-owner-id'
const judge = 'private-judge-id'
const other = 'private-other-id'
const anon = 'anon-spectator'
async function tool(userId: string, tool: string, params: Record<string, unknown>, privileged = false) {
  return (await room.fetch(new Request('https://internal/api/tools/execute', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': userId,
      ...(privileged ? { 'X-App-Action': 'true' } : {}) }, body: JSON.stringify({ tool, params }),
  }))).json() as Promise<ActionResult<{ record: Row; records: Row[]; users: unknown[] }>>
}
function ctx(userId: string, params: Record<string, unknown>): ActionContext<Env> {
  return { userId, params, callerJwt: 'fake-test-token', tools: {
    get: (collection: string, recordId: string) => tool(userId, 'records.get', { collection, recordId }, true),
    create: (collection: string, data: unknown, recordId?: string) => tool(userId, 'records.create', { collection, data, recordId }, true),
  } as ActionTools, env: { DEEPSPACE_APP_ID: 'test', RECORD_ROOMS: {
    idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => room.fetch(request) }),
  } } as unknown as Env }
}
async function scoreboard() {
  const result = await tool(anon, 'records.get', { collection: 'public_results', recordId: 'c' })
  if (!result.success) throw new Error(result.error)
  return result.data.record.data as unknown as PublicResults
}
const publish = (userId = owner) => publishResults(ctx(userId, { competitionId: 'c', entries: [{ score: 10 }], createdBy: judge }))
const score = (userId: string, value: number) => submitScore(ctx(userId, { competitionId: 'c', competitorId: 'p', value }))

beforeEach(async () => {
  vi.mocked(resolveAppRole).mockResolvedValue('member')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('WebSocketRequestResponsePair', class {})
  db = new DatabaseSync(':memory:')
  durable = new Map(); alarmAt = null; failProjection = false
  frames = Object.fromEntries([owner, judge, other, anon].map((id) => [id, []]))
  state = { id: { name: 'test:public' }, setWebSocketAutoResponse: () => {},
    getWebSockets: () => Object.keys(frames).map((userId) => ({ readyState: 1,
      deserializeAttachment: () => ({ userId, role: userId === anon ? 'viewer' : 'member' }),
      send: (message: string) => frames[userId].push(JSON.parse(message)),
    })),
    storage: {
      get: async (key: string) => durable.get(key),
      put: async (key: string, value: unknown) => { durable.set(key, value) },
      delete: async (key: string) => durable.delete(key),
      list: async ({ prefix }: { prefix: string }) => new Map([...durable].filter(([key]) => key.startsWith(prefix))),
      getAlarm: async () => alarmAt,
      setAlarm: async (time: number) => { alarmAt = time },
      sql: { exec: (sql: string, ...args: (string | number | null)[]) => {
        if (failProjection && /INSERT|UPDATE/.test(sql) && sql.includes('c_public_results')) throw new Error('Injected projection failure')
        const rows = db.prepare(sql).all(...args)
        return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }
      } },
    },
  } as unknown as DurableObjectState
  room = new PublicResultsRoom(state, {}, schemas, { ownerUserId: owner })
  for (const userId of [owner, judge, other]) await tool(owner, 'users.register', { userId, name: userId, email: `${userId}@example.test` }, true)
  await tool(owner, 'records.create', { collection: 'competitions', recordId: 'c', data: { name: 'Public competition' } }, true)
  await tool(owner, 'records.create', { collection: 'competitors', recordId: 'p', data: { name: 'Ada', competitionId: 'c' } }, true)
  await addJudge(ctx(owner, { competitionId: 'c', judgeId: judge }))
  for (const values of Object.values(frames)) values.length = 0
})
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps unpublished competitions unavailable and denies publication by judges/unrelated users/viewers', async () => {
  expect((await tool(anon, 'records.get', { collection: 'public_results', recordId: 'c' })).success).toBe(false)
  expect((await publish(judge)).success).toBe(false)
  expect((await publish(other)).success).toBe(false)
  vi.mocked(resolveAppRole).mockResolvedValue('viewer')
  expect((await publish(owner)).success).toBe(false)
  expect(durable.size).toBe(0)
})
it('publishes sanitized server aggregates, with no person identity in data or envelope', async () => {
  await score(judge, 8)
  await score(owner, 10)
  expect((await publish()).success).toBe(true)
  expect(await scoreboard()).toEqual({ name: 'Public competition', entries: [
    { name: 'Ada', score: 9, scoreCount: 2, rank: 1, tied: false },
  ] })
  const payload = JSON.stringify(frames[anon])
  expect(payload).toContain('scorespace-public-service')
  for (const secret of [owner, judge, other, 'organizerAccess', 'competitorId', scoreRecordId(judge, 'p')]) expect(payload).not.toContain(secret)
  expect(frames[anon].every((message) => message.payload?.collection === 'public_results')).toBe(true)
})
it('anonymous clients cannot read private records/directory or forge public writes', async () => {
  await publish(); await score(judge, 8)
  for (const collection of ['competitions', 'competitors', 'scores', 'team_members', 'users']) {
    const result = await tool(anon, 'records.query', { collection })
    expect(result).toMatchObject({ success: true, data: { records: [] } })
  }
  expect(await tool(anon, 'user.list', {})).toMatchObject({ success: true, data: { users: [] } })
  for (const userId of [anon, owner, judge, other]) {
    for (const operation of ['create', 'update', 'delete']) {
      expect((await tool(userId, `records.${operation}`, { collection: 'public_results', recordId: 'c', data: { name: 'Forged', entries: [] } })).success).toBe(false)
    }
  }
  expect((await scoreboard()).entries[0].score).toBe(8)
})
it('refreshes anonymous broadcasts after accepted scores and newly added competitors', async () => {
  await publish()
  frames[anon].length = 0
  expect((await score(judge, 8)).success).toBe(true)
  expect((await addCompetitor(ctx(owner, { competitionId: 'c', name: 'Bob' }))).success).toBe(true)
  expect((await scoreboard()).entries.map((entry) => [entry.name, entry.score, entry.rank])).toEqual([['Ada', 8, 1], ['Bob', null, null]])
  expect(frames[anon].filter((message) => message.payload?.collection === 'public_results')).toHaveLength(2)
  expect(frames[owner].some((message) => message.payload?.collection === 'scores')).toBe(true)
  expect(frames[other].some((message) => message.payload?.collection === 'scores')).toBe(false)
})
it('concurrent submissions cannot leave a stale public aggregate; immutable retries do not inflate counts', async () => {
  await publish()
  expect((await Promise.all([score(judge, 8), score(owner, 10)])).every((result) => result.success)).toBe(true)
  expect((await scoreboard()).entries[0]).toMatchObject({ score: 9, scoreCount: 2 })
  expect((await score(judge, 8)).success).toBe(true)
  expect((await score(judge, 9)).success).toBe(false)
  expect((await scoreboard()).entries[0]).toMatchObject({ score: 9, scoreCount: 2 })
})
it('recovers a failed projection after room restart without losing the accepted score', async () => {
  await publish()
  failProjection = true
  expect((await score(judge, 8)).success).toBe(true)
  expect((await scoreboard()).entries[0].score).toBeNull()
  expect(durable.size).toBe(1)
  expect(alarmAt).not.toBeNull()
  failProjection = false
  room = new PublicResultsRoom(state, {}, schemas, { ownerUserId: owner })
  alarmAt = null
  await room.alarm()
  expect((await scoreboard()).entries[0]).toMatchObject({ score: 8, scoreCount: 1 })
  expect(durable.size).toBe(0)
})
it('retries initial publication and failed recovery, and publication retries are idempotent', async () => {
  failProjection = true
  expect((await publish()).success).toBe(false)
  alarmAt = null
  await room.alarm()
  expect(alarmAt).not.toBeNull()
  failProjection = false
  await room.alarm()
  expect((await publish()).success).toBe(true)
  expect(await tool(anon, 'records.query', { collection: 'public_results' })).toMatchObject({ success: true, data: { count: 1 } })
  expect(durable.size).toBe(0)
})
