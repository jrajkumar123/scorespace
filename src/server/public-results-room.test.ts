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
import { removeJudge, removeCompetitor, deleteCompetition } from '../actions/lifecycle'

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
let failDeleteTable: string | null
let failMarkerDelete: boolean
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
  durable = new Map(); alarmAt = null; failProjection = false; failDeleteTable = null; failMarkerDelete = false
  frames = Object.fromEntries([owner, judge, other, anon].map((id) => [id, []]))
  state = { id: { name: 'test:public' }, setWebSocketAutoResponse: () => {},
    getWebSockets: () => Object.keys(frames).map((userId) => ({ readyState: 1,
      deserializeAttachment: () => ({ userId, role: userId === anon ? 'viewer' : 'member' }),
      send: (message: string) => frames[userId].push(JSON.parse(message)),
    })),
    storage: {
      get: async (key: string) => durable.get(key),
      put: async (key: string, value: unknown) => { durable.set(key, value) },
      delete: async (key: string) => {
        if (failMarkerDelete && key === 'lifecycle:pending:c') throw new Error('Injected marker cleanup failure')
        return durable.delete(key)
      },
      list: async ({ prefix }: { prefix: string }) => new Map([...durable].filter(([key]) => key.startsWith(prefix))),
      getAlarm: async () => alarmAt,
      setAlarm: async (time: number) => { alarmAt = time },
      sql: { exec: (sql: string, ...args: (string | number | null)[]) => {
        if (failProjection && /INSERT|UPDATE/.test(sql) && sql.includes('c_public_results')) throw new Error('Injected projection failure')
        if (failDeleteTable && sql.startsWith('DELETE') && sql.includes(failDeleteTable)) throw new Error('Injected delete failure')
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

const removalParams = { competitionId: 'c', competitorId: 'p', judgeId: judge }
const lifecycleActions = { removeJudge, removeCompetitor, deleteCompetition }

it.each(Object.entries(lifecycleActions))('%s rejects judges, unrelated users, viewers, absent parents and malformed targets', async (_, action) => {
  for (const userId of [judge, other, anon]) expect((await action(ctx(userId, removalParams))).success).toBe(false)
  for (const competitionId of ['', ' ', 42, null, 'missing']) {
    expect((await action(ctx(owner, { ...removalParams, competitionId }))).success).toBe(false)
  }
  vi.mocked(resolveAppRole).mockResolvedValue('viewer')
  expect((await action(ctx(owner, removalParams))).success).toBe(false)
  expect(durable.size).toBe(0)
  expect((await tool(owner, 'records.get', { collection: 'competitions', recordId: 'c' })).success).toBe(true)
})

it.each(['judgeId', 'competitorId'])('rejects invalid %s without creating a cleanup intent', async (field) => {
  const action = field === 'judgeId' ? removeJudge : removeCompetitor
  for (const value of [null, 0, {}, '', ' ', 'missing', owner]) {
    expect((await action(ctx(owner, { ...removalParams, [field]: value }))).success).toBe(false)
  }
  expect(durable.size).toBe(0)
})

it('revokes assignment and sends resubscribe; accepted scores and sanitized aggregates remain', async () => {
  await score(judge, 8); await score(owner, 10); await publish()
  const before = await scoreboard()
  expect((await removeJudge(ctx(owner, removalParams))).success).toBe(true)
  expect(frames[judge].some((message) => message.type === 'records.resubscribe')).toBe(true)
  for (const collection of ['competitions', 'competitors', 'team_members']) {
    expect(await tool(judge, 'records.query', { collection })).toMatchObject({ success: true, data: { records: [] } })
  }
  expect((await score(judge, 8)).success).toBe(false)
  expect(await tool(owner, 'records.query', { collection: 'scores' })).toMatchObject({ success: true, data: { count: 2 } })
  // Existing author ACL intentionally keeps their own historical scores readable.
  expect(await tool(judge, 'records.query', { collection: 'scores' })).toMatchObject({ success: true, data: { count: 1 } })
  expect(await scoreboard()).toEqual(before)
  expect(JSON.stringify(frames[anon])).not.toContain(judge)
  expect(durable.size).toBe(0)
})

it('removes only the chosen competitor and all of its scores, then broadcasts safe new standings', async () => {
  await score(judge, 8); await score(owner, 10)
  await tool(owner, 'records.create', { collection: 'competitors', recordId: 'p2', data: { name: 'Bob', competitionId: 'c' } }, true)
  await submitScore(ctx(judge, { competitionId: 'c', competitorId: 'p2', value: 7 }))
  await publish()
  expect((await removeCompetitor(ctx(owner, removalParams))).success).toBe(true)
  expect(await tool(owner, 'records.query', { collection: 'competitors' })).toMatchObject({ success: true, data: { records: [{ recordId: 'p2' }] } })
  expect(await tool(owner, 'records.query', { collection: 'scores' })).toMatchObject({ success: true, data: { records: [{ data: { competitorId: 'p2', value: 7 } }] } })
  expect((await scoreboard()).entries).toEqual([{ name: 'Bob', score: 7, scoreCount: 1, rank: 1, tied: false }])
  for (const userId of [owner, judge]) expect(frames[userId].some((message) => message.payload?.collection === 'competitors')).toBe(true)
  expect(frames[anon].filter((message) => message.payload?.collection).every((message) => message.payload?.collection === 'public_results')).toBe(true)
  expect(JSON.stringify(frames[anon])).not.toContain(judge)
  expect(durable.size).toBe(0)
})

it('deletes a competition and publication intent without touching another competition', async () => {
  await score(judge, 8); await publish()
  await tool(other, 'records.create', { collection: 'competitions', recordId: 'other-c', data: { name: 'Other' } }, true)
  await tool(other, 'records.create', { collection: 'competitors', recordId: 'other-p', data: { name: 'Untouched', competitionId: 'other-c' } }, true)
  await submitScore(ctx(other, { competitionId: 'other-c', competitorId: 'other-p', value: 6 }))
  await publishResults(ctx(other, { competitionId: 'other-c' }))
  durable.set('public-results:pending:c', true)
  expect((await deleteCompetition(ctx(owner, { competitionId: 'c' }))).success).toBe(true)
  for (const collection of ['competitions', 'competitors', 'scores', 'team_members', 'public_results']) {
    const result = await tool(owner, 'records.query', { collection }, true)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.records.every((row) => row.recordId !== 'c' && row.data.competitionId !== 'c' && row.data.teamId !== 'c')).toBe(true)
  }
  expect((await tool(other, 'records.get', { collection: 'competitors', recordId: 'other-p' })).success).toBe(true)
  expect((await tool(anon, 'records.get', { collection: 'public_results', recordId: 'other-c' })).success).toBe(true)
  expect((await tool(anon, 'records.get', { collection: 'public_results', recordId: 'c' })).success).toBe(false)
  expect(durable.size).toBe(0)
  await room.alarm()
  expect((await publish()).success).toBe(false)
})

it('rejects a competitor from a different competition even for the same organizer', async () => {
  await tool(owner, 'records.create', { collection: 'competitions', recordId: 'c2', data: { name: 'Second' } }, true)
  expect((await removeCompetitor(ctx(owner, { competitionId: 'c2', competitorId: 'p' }))).success).toBe(false)
  expect(durable.size).toBe(0)
})

it.each(Object.keys(lifecycleActions) as (keyof typeof lifecycleActions)[])('rechecks a delayed score at persistence after %s', async (operation) => {
  const context = ctx(judge, { competitionId: 'c', competitorId: 'p', value: 8 })
  const create = context.tools.create
  let release!: () => void
  let reached!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const ready = new Promise<void>((resolve) => { reached = resolve })
  context.tools.create = async (...args: Parameters<ActionTools['create']>) => {
    reached(); await gate
    return create(...args)
  }
  const delayed = submitScore(context)
  await ready
  expect((await lifecycleActions[operation](ctx(owner, operation === 'deleteCompetition' ? { competitionId: 'c' } : removalParams))).success).toBe(true)
  release()
  expect((await delayed).success).toBe(false)
  expect(await tool(owner, 'records.query', { collection: 'scores' }, true)).toMatchObject({ success: true, data: { records: [] } })
})

it.each(['removeCompetitor', 'deleteCompetition'] as const)('recovers interrupted %s after restart and blocks new writes/publication meanwhile', async (operation) => {
  await score(judge, 8); await publish()
  failDeleteTable = 'c_scores'
  const params = operation === 'deleteCompetition' ? { competitionId: 'c' } : removalParams
  expect((await lifecycleActions[operation](ctx(owner, params))).success).toBe(false)
  expect(durable.has('lifecycle:pending:c')).toBe(true)
  expect((await tool(anon, 'records.get', { collection: 'public_results', recordId: 'c' })).success).toBe(false)
  expect((await score(owner, 10)).success).toBe(false)
  expect((await addCompetitor(ctx(owner, { competitionId: 'c', name: 'Late' }))).success).toBe(false)
  expect((await addJudge(ctx(owner, { competitionId: 'c', judgeId: other }))).success).toBe(false)
  expect((await publish()).success).toBe(false)
  expect((await lifecycleActions[operation](ctx(other, params))).success).toBe(false)
  room = new PublicResultsRoom(state, {}, schemas, { ownerUserId: owner })
  alarmAt = null; await room.alarm()
  expect(alarmAt).not.toBeNull()
  failDeleteTable = null
  alarmAt = null; await room.alarm()
  expect(durable.size).toBe(0)
  expect(await tool(owner, 'records.query', { collection: 'scores' }, true)).toMatchObject({ success: true, data: { records: [] } })
  if (operation === 'removeCompetitor') expect((await scoreboard()).entries).toEqual([])
  else expect((await tool(owner, 'records.get', { collection: 'competitions', recordId: 'c' })).success).toBe(false)
})

it('retains publication consent across failed competitor projection and explicit retry', async () => {
  await publish(); failProjection = true
  expect((await removeCompetitor(ctx(owner, removalParams))).success).toBe(false)
  expect(durable.has('lifecycle:pending:c')).toBe(true)
  expect((await tool(anon, 'records.get', { collection: 'public_results', recordId: 'c' })).success).toBe(false)
  failProjection = false
  expect((await removeCompetitor(ctx(owner, removalParams))).success).toBe(true)
  expect((await scoreboard()).entries).toEqual([])
  expect(durable.size).toBe(0)
})

it('does not publish an unpublished competition during removal and clears stale orphan refresh intent', async () => {
  expect((await removeCompetitor(ctx(owner, removalParams))).success).toBe(true)
  expect((await tool(anon, 'records.get', { collection: 'public_results', recordId: 'c' })).success).toBe(false)
  durable.set('public-results:pending:missing', true)
  await room.alarm()
  expect(durable.size).toBe(0)
})

it('drains cascades beyond one SDK deleteWhere batch', async () => {
  for (let index = 0; index < 105; index++) {
    await tool(owner, 'records.create', { collection: 'competitors', recordId: `batch-${index}`, data: { name: `Entry ${index}`, competitionId: 'c' } }, true)
  }
  expect((await deleteCompetition(ctx(owner, { competitionId: 'c' }))).success).toBe(true)
  expect(await tool(owner, 'records.query', { collection: 'competitors' }, true)).toMatchObject({ success: true, data: { count: 0 } })
})

it.each(['addCompetitor', 'addJudge'] as const)('rejects delayed %s after competition deletion', async (operation) => {
  const context = ctx(owner, { competitionId: 'c', name: 'Late', judgeId: other })
  const create = context.tools.create
  let release!: () => void
  let reached!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const ready = new Promise<void>((resolve) => { reached = resolve })
  context.tools.create = async (...args: Parameters<ActionTools['create']>) => { reached(); await gate; return create(...args) }
  const delayed = (operation === 'addCompetitor' ? addCompetitor : addJudge)(context)
  await ready
  expect((await deleteCompetition(ctx(owner, { competitionId: 'c' }))).success).toBe(true)
  release()
  expect((await delayed).success).toBe(false)
  for (const collection of ['competitors', 'team_members']) {
    expect(await tool(owner, 'records.query', { collection }, true)).toMatchObject({ success: true, data: { records: [] } })
  }
})

it('recovers after parent deletion but before clearing intent, and denies ID reuse while pending', async () => {
  failMarkerDelete = true
  expect((await deleteCompetition(ctx(owner, { competitionId: 'c' }))).success).toBe(false)
  expect((await tool(owner, 'records.get', { collection: 'competitions', recordId: 'c' })).success).toBe(false)
  const socket = state.getWebSockets().find((ws) => ws.deserializeAttachment().userId === owner)!
  await room.webSocketMessage(socket, JSON.stringify({ type: 'core.put', payload: {
    collection: 'competitions', recordId: 'c', data: { name: 'Reused' }, requestId: 'reuse',
  } }))
  expect(frames[owner]).toContainEqual({ type: 'records.ack', payload: { requestId: 'reuse', success: false, error: 'Cleanup is pending. Please retry shortly.' } })
  expect((await deleteCompetition(ctx(other, { competitionId: 'c' }))).success).toBe(false)
  failMarkerDelete = false
  room = new PublicResultsRoom(state, {}, schemas, { ownerUserId: owner })
  expect((await deleteCompetition(ctx(owner, { competitionId: 'c' }))).success).toBe(true)
  expect(durable.size).toBe(0)
})

it('fails closed for forged internal requests and malformed lifecycle bodies', async () => {
  for (const body of ['{', 'null', '{}', '{"operation":"constructor","competitionId":"c"}']) {
    const response = await room.fetch(new Request('https://internal/internal/lifecycle', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Action': 'true', 'X-User-Id': owner }, body,
    }))
    expect((await response.json() as { success: boolean }).success).toBe(false)
  }
  const response = await room.fetch(new Request('https://internal/internal/lifecycle', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': owner },
    body: JSON.stringify({ operation: 'deleteCompetition', competitionId: 'c' }),
  }))
  expect(response.status).toBe(403)
  expect(durable.size).toBe(0)
})
