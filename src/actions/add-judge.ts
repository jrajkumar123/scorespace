import { resolveAppRole, type ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Competition } from '../schemas/competitions-schema'

export function assignmentRecordId(competitionId: string, userId: string): string {
  return `judge:${encodeURIComponent(JSON.stringify([competitionId, userId]))}`
}

export const addJudge: ActionHandler<Env> = async ({ params, userId, tools, env }) => {
  if (!params || typeof params.competitionId !== 'string' || !params.competitionId.trim()
    || typeof params.judgeId !== 'string' || !params.judgeId.trim()) {
    return { success: false, error: 'Select a competition and an existing user.' }
  }
  const role = await resolveAppRole(env, userId)
  if (role !== 'member' && role !== 'admin') return { success: false, error: 'Permission denied.' }
  // Privileged action tools bypass RBAC; explicitly authorize the parent first.
  const competition = await tools.get<Competition>('competitions', params.competitionId)
  if (!competition.success || competition.data.record.createdBy !== userId) {
    return { success: false, error: 'Competition not found or unavailable.' }
  }
  if (params.judgeId === userId) return { success: false, error: 'The organizer can already judge.' }
  const target = await tools.get<{ role: string }>('users', params.judgeId)
  if (!target.success || !['member', 'admin'].includes(target.data.record.data.role)) {
    return { success: false, error: 'Select an existing member or admin.' }
  }
  // No user record or private profile fields are returned to the browser.
  const competitionId = competition.data.record.recordId
  return tools.create('team_members', { teamId: competitionId, UserId: params.judgeId, status: 'active' },
    assignmentRecordId(competitionId, params.judgeId))
}
