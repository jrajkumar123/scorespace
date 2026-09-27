import { resolveAppRole, type ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

export const publishResults: ActionHandler<Env> = async ({ userId, params, env }) => {
  if (!params || typeof params.competitionId !== 'string' || !params.competitionId.trim()) {
    return { success: false, error: 'A competition is required.' }
  }
  const role = await resolveAppRole(env, userId)
  if (role !== 'member' && role !== 'admin') return { success: false, error: 'Permission denied.' }
  const room = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  // Internal DO route only; the outer action has already verified authentication.
  // The room checks ownership and builds the aggregate; browser data stops here.
  const response = await room.fetch(new Request('https://internal/internal/public-results/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, 'X-App-Action': 'true' },
    body: JSON.stringify({ competitionId: params.competitionId }),
  }))
  return response.json()
}
