import { beforeEach, expect, it, vi } from 'vitest'
import { canCreate, canDelete, canRead, canUpdate, resolveAppRole, type ActionContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { scoreRecordId, submitScore } from './submit-score'
import { scoresSchema } from '../schemas/scores-schema'

vi.mock('deepspace/worker', async (original) => ({
  ...await original<typeof import('deepspace/worker')>(), resolveAppRole: vi.fn(),
}))
const competition = { recordId: 'competition-a', createdBy: 'alice', data: { name: 'A' } }
const competitor = { recordId: 'competitor-a', createdBy: 'alice', data: { name: 'Ada', competitionId: 'competition-a' } }
function setup(params: unknown = { competitionId: 'competition-a', competitorId: 'competitor-a', value: 8.25 }) {
  const get = vi.fn(async (collection: string) => ({ success: true, data: { record: collection === 'competitions' ? competition : competitor } }))
  const create = vi.fn().mockResolvedValue({ success: true, data: { recordId: 'score-id' } })
  const ctx = { userId: 'alice', params, tools: { get, create }, env: {}, callerJwt: '' } as unknown as ActionContext<Env>
  return { ctx, get, create }
}
beforeEach(() => { vi.mocked(resolveAppRole).mockResolvedValue('member') })

it.each([1, 8.25, 10])('accepts valid score %s and uses verified IDs only', async (value) => {
  const { ctx, create } = setup({ competitionId: 'competition-a', competitorId: 'competitor-a', value, judgeId: 'bob', createdBy: 'bob', recordId: 'forged' })
  expect((await submitScore(ctx)).success).toBe(true)
  expect(create).toHaveBeenCalledExactlyOnceWith('scores', { competitorId: 'competitor-a', competitionId: 'competition-a', value }, scoreRecordId('alice', 'competitor-a'))
})
it.each([0, 0.99, 10.01, NaN, Infinity, -Infinity, '8', null, undefined])('rejects invalid score %s', async (value) => {
  const { ctx, get, create } = setup({ competitionId: 'competition-a', competitorId: 'competitor-a', value })
  expect((await submitScore(ctx)).success).toBe(false)
  expect(get).not.toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
})
it.each([null, {}, { competitionId: [], competitorId: 'a', value: 8 }, { competitionId: 'a', competitorId: '', value: 8 }])('rejects malformed references %j', async (params) => {
  const { ctx, create } = setup(params)
  expect((await submitScore(ctx)).success).toBe(false)
  expect(create).not.toHaveBeenCalled()
})
it.each(['member', 'admin'] as const)('rejects a foreign competition for %s', async (role) => {
  vi.mocked(resolveAppRole).mockResolvedValue(role)
  const { ctx, create } = setup()
  ctx.userId = 'bob'
  expect((await submitScore(ctx)).success).toBe(false)
  expect(create).not.toHaveBeenCalled()
})
it('rejects a competitor from another competition', async () => {
  const { ctx, create } = setup({ competitionId: 'competition-b', competitorId: 'competitor-a', value: 8 })
  expect((await submitScore(ctx)).success).toBe(false)
  expect(create).not.toHaveBeenCalled()
})
it('rejects a viewer', async () => {
  vi.mocked(resolveAppRole).mockResolvedValue('viewer')
  const { ctx, create } = setup()
  expect((await submitScore(ctx)).success).toBe(false)
  expect(create).not.toHaveBeenCalled()
})
it.each(['competitions', 'competitors'])('rejects missing %s', async (missing) => {
  const { ctx, get, create } = setup()
  get.mockImplementation(async (collection) => collection === missing
    ? { success: false, error: 'Not found' } as never
    : { success: true, data: { record: competitor } })
  expect((await submitScore(ctx)).success).toBe(false)
  expect(create).not.toHaveBeenCalled()
})
it('reports a refused overwrite and propagates other write failures', async () => {
  const { ctx, create } = setup()
  create.mockResolvedValueOnce({ success: false, error: "Cannot modify immutable field 'value'" })
  expect(await submitScore(ctx)).toMatchObject({ success: false, error: expect.stringContaining('already submitted') })
  create.mockResolvedValueOnce({ success: false, error: 'Storage unavailable' })
  expect(await submitScore(ctx)).toEqual({ success: false, error: 'Storage unavailable' })
})
it('assigns distinct stable keys without delimiter collisions', () => {
  expect(scoreRecordId('alice', 'a')).toBe(scoreRecordId('alice', 'a'))
  expect(scoreRecordId('alice', 'a')).not.toBe(scoreRecordId('bob', 'a'))
  expect(scoreRecordId('a:b', 'c')).not.toBe(scoreRecordId('a', 'b:c'))
})
it.each(['member', 'admin'])('%s reads own scores but cannot directly mutate', (role) => {
  const record = { createdBy: 'alice', data: { value: 8, competitorId: 'a', competitionId: 'b' } }
  expect(canRead(scoresSchema, role, record, 'alice')).toBe(true)
  expect(canRead(scoresSchema, role, record, 'bob')).toBe(false)
  expect(canCreate(scoresSchema, role)).toBe(false)
  expect(canUpdate(scoresSchema, role, record, 'alice')).toBe(false)
  expect(canDelete(scoresSchema, role, record, 'alice')).toBe(false)
})
