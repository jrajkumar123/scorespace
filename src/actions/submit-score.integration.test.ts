// @ts-expect-error The scaffold omits Node typings; node:sqlite is built into the supported Node 22.15+/24 runtimes.
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RecordRoom, type ActionResult } from 'deepspace/worker'
import { scoresSchema } from '../schemas/scores-schema'
import { scoreRecordId } from './submit-score'

// Real installed RecordRoom + SQLite; only the Cloudflare state/socket adapter is
// replaced. No credentials or live app data. This checks SDK upserts, not a mock
// implementation of the immutable/primary-key behavior on which scoring relies.
type TestDatabase = { prepare: (sql: string) => { all: (...params: (string | number | null)[]) => Record<string, unknown>[] }; close: () => void }
let db: TestDatabase
let room: RecordRoom
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  vi.stubGlobal('WebSocketRequestResponsePair', class {})
  const state = {
    id: { name: 'test:scores' }, getWebSockets: () => [], setWebSocketAutoResponse: () => {},
    storage: { sql: { exec: (query: string, ...params: (string | number | null)[]) => {
      const rows = db.prepare(query).all(...params)
      return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }
    } } },
  } as unknown as DurableObjectState
  room = new RecordRoom(state, {}, [scoresSchema], { ownerUserId: 'alice' })
})
afterEach(() => { db.close(); vi.unstubAllGlobals() })

async function tool(userId: string, name: string, params: Record<string, unknown>, privileged = true) {
  const response = await room.fetch(new Request('https://internal/api/tools/execute', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': userId,
      ...(privileged ? { 'X-App-Action': 'true' } : {}) },
    body: JSON.stringify({ tool: name, params }),
  }))
  return response.json() as Promise<ActionResult<{ records: { data: { value: number }; createdBy: string }[] }>>
}
function write(userId: string, value: number) {
  return tool(userId, 'records.create', {
    collection: 'scores', recordId: scoreRecordId(userId, 'competitor-a'),
    data: { competitorId: 'competitor-a', competitionId: 'competition-a', value },
  })
}

it('concurrent different values persist exactly one immutable score', async () => {
  const results = await Promise.all([write('alice', 8.25), write('alice', 9.5)])
  expect(results.filter((result) => result.success)).toHaveLength(1)
  expect(results.find((result) => !result.success)).toMatchObject({ error: "Cannot modify immutable field 'value'" })
  const records = await tool('alice', 'records.query', { collection: 'scores' })
  expect(records.success).toBe(true)
  if (!records.success) throw new Error(records.error)
  expect(records.data.records).toHaveLength(1)
  expect(records.data.records[0].createdBy).toBe('alice')
  const value = records.data.records[0].data.value
  expect((await write('alice', value)).success).toBe(true)
  expect((await write('alice', value === 8.25 ? 9.5 : 8.25)).success).toBe(false)
})
it('identical concurrent retries reuse one row and different judges have different rows', async () => {
  expect((await Promise.all([write('alice', 8), write('alice', 8)])).every((result) => result.success)).toBe(true)
  expect((await write('bob', 7)).success).toBe(true)
  const records = await tool('alice', 'records.query', { collection: 'scores' })
  if (!records.success) throw new Error(records.error)
  expect(records.data.records).toHaveLength(2)
  // Actual ordinary-admin reads remain owner-scoped even though the test seeded both rows.
  const own = await tool('alice', 'records.query', { collection: 'scores' }, false)
  if (!own.success) throw new Error(own.error)
  expect(own.data.records).toHaveLength(1)
  expect(own.data.records[0].createdBy).toBe('alice')
  expect((await tool('alice', 'records.create', { collection: 'scores', data: {
    competitorId: 'b', competitionId: 'a', value: 8,
  } }, false)).success).toBe(false)
})
