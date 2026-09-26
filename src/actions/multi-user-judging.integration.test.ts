// @ts-expect-error node:sqlite is built into the supported runtime; scaffold omits Node typings.
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RecordRoom, resolveAppRole, type ActionContext, type ActionResult, type ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { schemas } from '../schemas'
import { addJudge, assignmentRecordId } from './add-judge'
import { addCompetitor } from './add-competitor'
import { submitScore } from './submit-score'

// Only platform membership lookup and the Cloudflare adapter are substituted.
// All records, permission checks, broadcasts, immutable writes and actions are real.
vi.mock('deepspace/worker', async (original) => ({
  ...await original<typeof import('deepspace/worker')>(), resolveAppRole: vi.fn(),
}))
type Row = { recordId: string; createdBy: string; data: Record<string, unknown> }
type Message = { type: string; payload?: { collection?: string; record?: Row } }
let db: { prepare: (sql: string) => { all: (...args: (string | number | null)[]) => Record<string, unknown>[] }; close: () => void }
let room: RecordRoom
let messages: Record<string, Message[]>
async function tool(userId: string, name: string, params: Record<string, unknown>, privileged = false) {
  return (await room.fetch(new Request('https://internal/api/tools/execute', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': userId,
      ...(privileged ? { 'X-App-Action': 'true' } : {}) },
    body: JSON.stringify({ tool: name, params }),
  }))).json() as Promise<ActionResult<{ records: Row[]; record: Row }>>
}
function context(userId: string, params: Record<string, unknown>): ActionContext<Env> {
  const tools = {
    get: (collection: string, recordId: string) => tool(userId, 'records.get', { collection, recordId }, true),
    create: (collection: string, data: unknown, recordId?: string) => tool(userId, 'records.create', { collection, data, recordId }, true),
  } as ActionTools
  return { userId, params, tools, env: {} as Env, callerJwt: '' }
}
async function query(userId: string, collection: string) {
  const result = await tool(userId, 'records.query', { collection })
  if (!result.success) throw new Error(result.error)
  return result.data.records
}
const assign = (caller = 'alice', judgeId = 'bob', competitionId = 'c1') =>
  addJudge(context(caller, { competitionId, judgeId, recordId: 'forged', createdBy: 'forged' }))
const score = (caller: string, value = 8, competitorId = 'p1', competitionId = 'c1') =>
  submitScore(context(caller, { competitionId, competitorId, value, userId: 'alice', judgeId: 'alice', recordId: 'forged', organizerAccess: '["eve"]' }))

beforeEach(async () => {
  vi.mocked(resolveAppRole).mockResolvedValue('member')
  db = new DatabaseSync(':memory:')
  vi.stubGlobal('WebSocketRequestResponsePair', class {})
  messages = Object.fromEntries(['alice', 'bob', 'carol', 'eve'].map((id) => [id, []]))
  const sockets = Object.keys(messages).map((userId) => ({ readyState: 1,
    deserializeAttachment: () => ({ userId, role: userId === 'alice' ? 'admin' : 'member' }),
    send: (value: string) => messages[userId].push(JSON.parse(value)),
  }))
  const state = { id: { name: 'test:multi-user' }, getWebSockets: () => sockets, setWebSocketAutoResponse: () => {},
    storage: { sql: { exec: (sql: string, ...args: (string | number | null)[]) => {
      const rows = db.prepare(sql).all(...args)
      return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }
    } } },
  } as unknown as DurableObjectState
  room = new RecordRoom(state, {}, schemas, { ownerUserId: 'alice' })
  for (const userId of Object.keys(messages)) {
    await tool('alice', 'users.register', { userId, name: userId, email: `${userId}@example.test`, isAdmin: userId === 'alice' }, true)
  }
  for (const [recordId, userId] of [['c1', 'alice'], ['c2', 'eve']]) {
    await tool(userId, 'records.create', { collection: 'competitions', recordId, data: { name: recordId } }, true)
  }
  await tool('alice', 'records.create', { collection: 'competitors', recordId: 'p1', data: { name: 'Ada', competitionId: 'c1' } }, true)
  for (const values of Object.values(messages)) values.length = 0
})
afterEach(() => { db.close(); vi.unstubAllGlobals() })

it('assignment grants scoped queries/gets and requests resubscription of already-connected judges', async () => {
  expect(await query('bob', 'competitions')).toHaveLength(0)
  expect((await assign()).success).toBe(true)
  expect((await query('bob', 'competitions')).map((r) => r.recordId)).toEqual(['c1'])
  expect((await tool('bob', 'records.get', { collection: 'competitions', recordId: 'c1' })).success).toBe(true)
  expect(await query('bob', 'competitors')).toHaveLength(1)
  expect((await query('eve', 'competitions')).map((r) => r.recordId)).toEqual(['c2'])
  expect(await query('eve', 'competitors')).toHaveLength(0)
  expect((await tool('eve', 'records.get', { collection: 'competitions', recordId: 'c1' })).success).toBe(false)
  expect(messages.bob.some((m) => m.type.includes('resubscribe'))).toBe(true)
  expect(messages.eve.some((m) => m.type.includes('resubscribe'))).toBe(false)
  expect(await query('bob', 'team_members')).toHaveLength(0)
  expect(await query('alice', 'team_members')).toHaveLength(1)
})

it('broadcasts competitors and computed competition access only to owner and assigned judges', async () => {
  await assign()
  await tool('alice', 'records.update', { collection: 'competitions', recordId: 'c1', data: { name: 'Updated' } }, true)
  await addCompetitor(context('alice', { competitionId: 'c1', name: 'Bob' }))
  for (const collection of ['competitions', 'competitors']) {
    expect(messages.alice.some((m) => m.payload?.collection === collection)).toBe(true)
    expect(messages.bob.some((m) => m.payload?.collection === collection)).toBe(true)
    expect(messages.eve.some((m) => m.payload?.collection === collection)).toBe(false)
  }
})

it('raw-score queries, gets and broadcasts expose only author plus organizer', async () => {
  await assign(); await assign('alice', 'carol')
  expect((await score('bob', 8)).success).toBe(true)
  expect((await score('carol', 9.5)).success).toBe(true)
  expect((await score('alice', 10)).success).toBe(true)
  expect(await query('alice', 'scores')).toHaveLength(3)
  for (const userId of ['bob', 'carol']) {
    const records = await query(userId, 'scores')
    expect(records).toHaveLength(1)
    expect(records[0].createdBy).toBe(userId)
    expect(records[0].data.organizerAccess).toBe('["alice"]')
    expect(messages[userId].filter((m) => m.payload?.collection === 'scores').every((m) => m.payload?.record?.createdBy === userId)).toBe(true)
  }
  const bobScore = (await query('bob', 'scores'))[0]
  expect((await tool('carol', 'records.get', { collection: 'scores', recordId: bobScore.recordId })).success).toBe(false)
  expect(await query('eve', 'scores')).toHaveLength(0)
  expect(messages.eve.filter((m) => m.payload?.collection === 'scores')).toHaveLength(0)
  expect(messages.alice.filter((m) => m.payload?.collection === 'scores')).toHaveLength(3)
})

it('rejects forged parent/identity and organizer operations by assigned judges, including app admins', async () => {
  await assign()
  expect((await score('eve')).success).toBe(false)
  expect((await score('bob', 8, 'p1', 'c2')).success).toBe(false)
  for (const role of ['member', 'admin'] as const) {
    vi.mocked(resolveAppRole).mockResolvedValue(role)
    expect((await addCompetitor(context('bob', { competitionId: 'c1', name: 'Forged' }))).success).toBe(false)
    expect((await assign('bob', 'eve')).success).toBe(false)
  }
  expect(await query('alice', 'scores')).toHaveLength(0)
})

it('blocks direct collection writes, including forged team links and organizer access', async () => {
  await assign()
  for (const caller of ['alice', 'bob', 'eve']) {
    for (const collection of ['team_members', 'competitors', 'scores']) {
      expect((await tool(caller, 'records.create', { collection, data: { teamId: 'c1', UserId: 'eve', status: 'active', name: 'Forged', competitionId: 'c1', competitorId: 'p1', value: 8 } })).success).toBe(false)
    }
    expect((await tool(caller, 'records.update', { collection: 'competitions', recordId: 'c1', data: { name: 'Forged' } })).success).toBe(false)
    expect((await tool(caller, 'records.delete', { collection: 'team_members', recordId: assignmentRecordId('c1', 'bob') })).success).toBe(false)
  }
})

it('assignment and score retries are idempotent under concurrency; differing scores cannot overwrite', async () => {
  expect((await Promise.all([assign(), assign()])).every((r) => r.success)).toBe(true)
  expect(await query('alice', 'team_members')).toHaveLength(1)
  const results = await Promise.all([score('bob', 8), score('bob', 9)])
  expect(results.filter((r) => r.success)).toHaveLength(1)
  const records = await query('bob', 'scores')
  expect(records).toHaveLength(1)
  expect((await score('bob', records[0].data.value as number)).success).toBe(true)
})

it('rejects missing users, self-assignment, malformed input and viewers', async () => {
  expect((await assign('alice', 'missing')).success).toBe(false)
  expect((await assign('alice', 'alice')).success).toBe(false)
  expect((await addJudge(context('alice', {}))).success).toBe(false)
  vi.mocked(resolveAppRole).mockResolvedValue('viewer')
  expect((await assign()).success).toBe(false)
  expect(await query('alice', 'team_members')).toHaveLength(0)
})

it('preserves legacy owner scores and same-value retries after adding the optional access column', async () => {
  const { scoreRecordId } = await import('./submit-score')
  await tool('alice', 'records.create', { collection: 'scores', recordId: scoreRecordId('alice', 'p1'),
    data: { competitorId: 'p1', competitionId: 'c1', value: 8 } }, true)
  expect((await score('alice', 8)).success).toBe(true)
  expect((await score('alice', 9)).success).toBe(false)
  expect(await query('alice', 'scores')).toHaveLength(1)
})

it('a forged computed team field cannot expose another competition', async () => {
  await assign()
  expect((await tool('eve', 'records.create', { collection: 'competitions', recordId: 'c3',
    data: { name: 'Private', competitionId: 'c1' } })).success).toBe(true)
  expect((await query('eve', 'competitions')).find((row) => row.recordId === 'c3')?.data.competitionId).toBe('c3')
  expect((await query('bob', 'competitions')).map((row) => row.recordId)).toEqual(['c1'])
})
