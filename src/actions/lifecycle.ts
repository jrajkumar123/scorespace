import { resolveAppRole, type ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

export type LifecycleOperation = 'removeJudge' | 'removeCompetitor' | 'deleteCompetition'
export type LifecycleInput = { operation: LifecycleOperation; competitionId: string; targetId?: string }

function lifecycle(operation: LifecycleOperation, targetField?: 'judgeId' | 'competitorId'): ActionHandler<Env> {
  return async ({ userId, params, env }) => {
    if (!params || typeof params.competitionId !== 'string' || !params.competitionId.trim()
      || (targetField && (typeof params[targetField] !== 'string' || !params[targetField].trim()))) {
      return { success: false, error: 'Select a competition and a valid removal target.' }
    }
    const role = await resolveAppRole(env, userId)
    if (role !== 'member' && role !== 'admin') return { success: false, error: 'Permission denied.' }
    const room = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
    // Ownership is checked inside the room's write queue, not just before it.
    const response = await room.fetch(new Request('https://internal/internal/lifecycle', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, 'X-App-Action': 'true' },
      body: JSON.stringify({ operation, competitionId: params.competitionId, targetId: targetField ? params[targetField] : undefined }),
    }))
    return response.json()
  }
}

export const removeJudge = lifecycle('removeJudge', 'judgeId')
export const removeCompetitor = lifecycle('removeCompetitor', 'competitorId')
export const deleteCompetition = lifecycle('deleteCompetition')
