import { resolveAppRole, type ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Competition } from '../schemas/competitions-schema'

export const addCompetitor: ActionHandler<Env> = async ({ params, userId, tools, env }) => {
  if (!params || typeof params.name !== 'string' || !params.name.trim()
    || typeof params.competitionId !== 'string' || !params.competitionId.trim()) {
    return { success: false, error: 'A competition and a non-empty competitor name are required.' }
  }

  const role = await resolveAppRole(env, userId)
  if (role !== 'member' && role !== 'admin') {
    return { success: false, error: 'You do not have permission to add competitors.' }
  }

  // Action tools bypass RBAC: authentication alone does not authorize this write.
  const parent = await tools.get<Competition>('competitions', params.competitionId)
  if (!parent.success || parent.data.record.createdBy !== userId) {
    // Do not reveal whether another user's competition exists.
    return { success: false, error: 'Competition not found or unavailable.' }
  }

  // The existing action tools assign createdBy from the verified caller.
  // Pick only these fields: never forward client-supplied ownership or record IDs.
  return tools.create('competitors', {
    name: params.name.trim(),
    competitionId: parent.data.record.recordId,
  })
}
