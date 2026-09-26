import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canCreate, canDelete, canRead, canUpdate, resolveAppRole, type ActionContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { addCompetitor } from './add-competitor'
import { competitorsSchema } from '../schemas/competitors-schema'

vi.mock('deepspace/worker', async (importOriginal) => ({
  ...await importOriginal<typeof import('deepspace/worker')>(),
  resolveAppRole: vi.fn(),
}))

const parent = {
  recordId: 'competition-a', createdBy: 'alice', data: { name: 'Alice competition' },
  createdAt: '', updatedAt: '',
}

function context(params: unknown = { name: '  Ada  ', competitionId: parent.recordId }) {
  const get = vi.fn().mockResolvedValue({ success: true, data: { record: parent } })
  const create = vi.fn().mockResolvedValue({ success: true, data: { recordId: 'competitor-a' } })
  // Unused tool methods and environment bindings are intentionally absent.
  const ctx = { userId: 'alice', params, tools: { get, create }, env: {}, callerJwt: '' } as unknown as ActionContext<Env>
  return { ctx, get, create }
}

beforeEach(() => { vi.mocked(resolveAppRole).mockResolvedValue('member') })

describe('addCompetitor authorization', () => {
  it('checks the parent and persists only the trimmed name and canonical parent ID', async () => {
    const { ctx, get, create } = context({ name: '  Ada  ', competitionId: parent.recordId, createdBy: 'bob', recordId: 'forged' })
    expect(await addCompetitor(ctx)).toEqual({ success: true, data: { recordId: 'competitor-a' } })
    expect(get).toHaveBeenCalledWith('competitions', parent.recordId)
    expect(create).toHaveBeenCalledExactlyOnceWith('competitors', { name: 'Ada', competitionId: parent.recordId })
  })

  it.each(['member', 'admin'] as const)('rejects another owner even for %s', async (role) => {
    vi.mocked(resolveAppRole).mockResolvedValue(role)
    const { ctx, create } = context()
    ctx.userId = 'bob'
    expect(await addCompetitor(ctx)).toEqual({ success: false, error: 'Competition not found or unavailable.' })
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects a missing parent without creating an orphan', async () => {
    const { ctx, get, create } = context()
    get.mockResolvedValue({ success: false, error: 'Record not found' })
    expect(await addCompetitor(ctx)).toEqual({ success: false, error: 'Competition not found or unavailable.' })
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects viewers even when they own the parent', async () => {
    vi.mocked(resolveAppRole).mockResolvedValue('viewer')
    const { ctx, get, create } = context()
    expect((await addCompetitor(ctx)).success).toBe(false)
    expect(get).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it.each([null, {}, { name: ' ', competitionId: 'a' }, { name: 3, competitionId: 'a' },
    { name: 'Ada', competitionId: '' }, { name: 'Ada', competitionId: ['a', 'b'] }])('rejects malformed input %j', async (params) => {
    const { ctx, get, create } = context(params)
    expect((await addCompetitor(ctx)).success).toBe(false)
    expect(get).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('returns a persistence refusal rather than reporting success', async () => {
    const { ctx, create } = context()
    create.mockResolvedValue({ success: false, error: 'Write rejected' })
    expect(await addCompetitor(ctx)).toEqual({ success: false, error: 'Write rejected' })
  })
})

describe('competitor permissions using the installed SDK evaluators', () => {
  const child = { createdBy: 'alice', data: { name: 'Ada', competitionId: parent.recordId } }
  it.each(['member', 'admin'])('%s can read only their own competitors and cannot write directly', (role) => {
    expect(canRead(competitorsSchema, role, child, 'alice')).toBe(true)
    expect(canRead(competitorsSchema, role, child, 'bob')).toBe(false)
    expect(canCreate(competitorsSchema, role)).toBe(false)
    expect(canUpdate(competitorsSchema, role, child, 'alice')).toBe(false)
    expect(canDelete(competitorsSchema, role, child, 'alice')).toBe(false)
  })
  it.each(['viewer', '*'])('%s cannot read or create competitors', (role) => {
    expect(canRead(competitorsSchema, role, child, 'alice')).toBe(false)
    expect(canCreate(competitorsSchema, role)).toBe(false)
  })
})
