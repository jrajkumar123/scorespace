import { resolveAppRole, type ActionHandler } from 'deepspace/worker'
import { assignmentRecordId } from './add-judge'
import type { TeamMember } from '../schemas/team-members-schema'
import type { Env } from '../../worker'
import type { Competition } from '../schemas/competitions-schema'
import type { Competitor } from '../schemas/competitors-schema'

// JSON tuple encoding avoids ambiguous concatenations (e.g. a:b + c vs a + b:c).
// The server chooses this primary key; the browser never supplies it.
export function scoreRecordId(userId: string, competitorId: string): string {
  return `score:${encodeURIComponent(JSON.stringify([userId, competitorId]))}`
}

export const submitScore: ActionHandler<Env> = async ({ params, userId, tools, env }) => {
  if (!params || typeof params.competitorId !== 'string' || !params.competitorId.trim()
    || typeof params.competitionId !== 'string' || !params.competitionId.trim()) {
    return { success: false, error: 'A competition and competitor are required.' }
  }
  if (typeof params.value !== 'number' || !Number.isFinite(params.value) || params.value < 1 || params.value > 10) {
    return { success: false, error: 'Enter a finite score from 1 to 10.' }
  }
  const role = await resolveAppRole(env, userId)
  if (role !== 'member' && role !== 'admin') {
    return { success: false, error: 'You do not have permission to submit scores.' }
  }
  const competitor = await tools.get<Competitor>('competitors', params.competitorId)
  if (!competitor.success || competitor.data.record.data.competitionId !== params.competitionId) {
    return { success: false, error: 'Competition or competitor not found or unavailable.' }
  }
  const competition = await tools.get<Competition>('competitions', competitor.data.record.data.competitionId)
  if (!competition.success) {
    return { success: false, error: 'Competition or competitor not found or unavailable.' }
  }
  if (competition.data.record.createdBy !== userId) {
    const assignment = await tools.get<TeamMember>('team_members', assignmentRecordId(competition.data.record.recordId, userId))
    if (!assignment.success || assignment.data.record.data.teamId !== competition.data.record.recordId
      || assignment.data.record.data.UserId !== userId || assignment.data.record.data.status !== 'active'
      || assignment.data.record.createdBy !== competition.data.record.createdBy) {
      return { success: false, error: 'Competition or competitor not found or unavailable.' }
    }
  }
  // This is an upsert, not insert-only. RecordRoom enforces immutable fields even
  // for app actions: same-value retries succeed; a different value cannot overwrite.
  // No read-then-create duplicate check is used as a concurrency boundary.
  const result = await tools.create('scores', {
    competitorId: competitor.data.record.recordId,
    competitionId: competitor.data.record.data.competitionId,
    value: params.value,
    // Owner-authored scores need no collaborator; this also preserves legacy retries.
    ...(competition.data.record.createdBy !== userId
      ? { organizerAccess: JSON.stringify([competition.data.record.createdBy]) } : {}),
  }, scoreRecordId(userId, competitor.data.record.recordId))
  if (!result.success && result.error === "Cannot modify immutable field 'value'") {
    return { success: false, error: 'You already submitted a score for this competitor. Scores cannot be changed.' }
  }
  return result
}
