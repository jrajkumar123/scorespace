import { MSG, RECORD_NOT_FOUND, RecordRoom, serverBuild, type ActionResult } from 'deepspace/worker'
import { assignmentRecordId } from '../actions/add-judge'
import type { LifecycleInput } from '../actions/lifecycle'
import type { TeamMember } from '../schemas/team-members-schema'
import { buildPublicResults } from '../lib/public-results'
import type { Competition } from '../schemas/competitions-schema'
import type { Competitor } from '../schemas/competitors-schema'
import type { Score } from '../schemas/scores-schema'

type Row<T> = { recordId: string; createdBy: string; data: T }
const PENDING = 'public-results:pending:'
const SERVICE_ID = 'scorespace-public-service'
const RETRY_MS = 30_000
const CLEANUP = 'lifecycle:pending:'
type Cleanup = LifecycleInput & { ownerId: string; refreshPublic: boolean }
const unavailable = () => Response.json({ success: false, error: 'Competition or removal target not found or unavailable.' }, { status: 403 })
const busy = () => Response.json({ success: false, error: 'Cleanup is pending. Please retry shortly.' }, { status: 503 })

/** A public projection of private records, maintained in the same Durable Object.
 * No SDK internals or SQL tables are modified. All record operations use the
 * existing tools API; KV markers + a DO alarm recover interrupted refreshes.
 */
export class PublicResultsRoom<E = Record<string, unknown>> extends RecordRoom<E> {
  private projectionQueue: Promise<unknown> = Promise.resolve()

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.projectionQueue.then(operation)
    this.projectionQueue = next.catch(() => {})
    return next
  }

  // Interlock native competition creation with cascades too. In particular, a
  // caller cannot reuse an ID while a durable cleanup for that ID is unfinished.
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.serialize(async () => {
      if (typeof message === 'string') {
        let msg
        try { msg = JSON.parse(message) } catch { /* SDK reports malformed messages. */ }
        if (msg?.type === MSG.PUT && msg.payload?.collection === 'competitions'
          && typeof msg.payload.recordId === 'string' && await this.state.storage.get(CLEANUP + msg.payload.recordId)) {
          this.sendLifecycleMessage(ws, typeof msg.payload.requestId === 'string'
            ? serverBuild.ackFailure(msg.payload.requestId, 'Cleanup is pending. Please retry shortly.')
            : serverBuild.error('Cleanup is pending. Please retry shortly.'))
          return
        }
      }
      await super.webSocketMessage(ws, message)
    })
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    const privileged = request.headers.get('X-App-Action') === 'true'
    if (path === '/internal/lifecycle') {
      if (request.method !== 'POST' || !privileged || !request.headers.get('X-User-Id')) return unavailable()
      let input: LifecycleInput
      try { input = await request.json() } catch { return unavailable() }
      if (!input || !['removeJudge', 'removeCompetitor', 'deleteCompetition'].includes(input.operation)
        || typeof input.competitionId !== 'string' || !input.competitionId.trim()
        || (input.operation !== 'deleteCompetition' && (typeof input.targetId !== 'string' || !input.targetId.trim()))) return unavailable()
      return this.serialize(() => this.startCleanup(input, request.headers.get('X-User-Id')!))
    }
    if (path === '/internal/public-results/publish') {
      if (request.method !== 'POST' || !privileged || !request.headers.get('X-User-Id')) {
        return Response.json({ success: false, error: 'Permission denied.' }, { status: 403 })
      }
      const { competitionId } = await request.json() as { competitionId?: unknown }
      if (typeof competitionId !== 'string' || !competitionId) {
        return Response.json({ success: false, error: 'A competition is required.' }, { status: 400 })
      }
      return this.serialize(async () => {
        if (await this.state.storage.get(CLEANUP + competitionId)) return busy()
        const parent = await this.tool<{ record: Row<Competition> }>('records.get', { collection: 'competitions', recordId: competitionId })
        if (!parent.success || parent.data.record.createdBy !== request.headers.get('X-User-Id')) {
          return Response.json({ success: false, error: 'Competition not found or unavailable.' }, { status: 403 })
        }
        // This is the durable publication intent. No page visit publishes data.
        await this.markPending(competitionId)
        if (!await this.tryRefresh(competitionId)) {
          return Response.json({ success: false, error: 'Publication is pending. Please retry shortly.' }, { status: 503 })
        }
        return Response.json({ success: true, data: { recordId: competitionId } })
      })
    }

    if (path === '/api/tools/execute' && request.method === 'POST' && privileged) {
      const body = await request.clone().json() as { tool?: string; params?: { collection?: string; recordId?: string; data?: { competitionId?: string; teamId?: string; competitorId?: string } } }
      const { tool, params } = body
      const competitionId = params?.collection === 'competitions' ? params.recordId
        : params?.collection === 'team_members' ? params.data?.teamId : params?.data?.competitionId
      if (tool === 'records.create' && typeof competitionId === 'string'
        && ['competitions', 'scores', 'competitors', 'team_members'].includes(params?.collection ?? '')) {
        return this.serialize(async () => {
          if (await this.state.storage.get(CLEANUP + competitionId)) return busy()
          // Actions may have checked authorization before waiting for this queue.
          // Recheck here so delayed submissions cannot outlive a revocation/delete.
          if (params?.collection !== 'competitions'
            && !await this.authorizeWrite(request.headers.get('X-User-Id') ?? '', competitionId, params?.collection, params?.data?.competitorId)) return unavailable()
          const published = await this.tool('records.get', { collection: 'public_results', recordId: competitionId })
          const needsRefresh = published.success || await this.state.storage.get<boolean>(PENDING + competitionId)
          // Mark BEFORE accepting the private write so a restart cannot lose work.
          if (needsRefresh) await this.markPending(competitionId)
          const response = await super.fetch(request)
          if (needsRefresh) await this.tryRefresh(competitionId)
          // A persisted score stays accepted if publication temporarily fails.
          // The durable marker/alarm retries the public projection independently.
          return response
        })
      }
    }
    return super.fetch(request)
  }

  private async authorizeWrite(userId: string, competitionId: string, collection?: string, competitorId?: string): Promise<boolean> {
    const parent = await this.tool<{ record: Row<Competition> }>('records.get', { collection: 'competitions', recordId: competitionId })
    if (!parent.success) return false
    if (collection !== 'scores') return parent.data.record.createdBy === userId
    const competitor = await this.tool<{ record: Row<Competitor> }>('records.get', { collection: 'competitors', recordId: competitorId })
    if (!competitor.success || competitor.data.record.data.competitionId !== competitionId) return false
    if (parent.data.record.createdBy === userId) return true
    const assignment = await this.tool<{ record: Row<TeamMember> }>('records.get', {
      collection: 'team_members', recordId: assignmentRecordId(competitionId, userId),
    })
    return assignment.success && assignment.data.record.createdBy === parent.data.record.createdBy
      && assignment.data.record.data.teamId === competitionId && assignment.data.record.data.UserId === userId
      && assignment.data.record.data.status === 'active'
  }

  private async startCleanup(input: LifecycleInput, userId: string): Promise<Response> {
    const key = CLEANUP + input.competitionId
    let job = await this.state.storage.get<Cleanup>(key)
    if (job) {
      // The persisted owner also authorizes recovery after the parent was deleted.
      if (job.ownerId !== userId) return unavailable()
      if (job.operation !== input.operation || job.targetId !== input.targetId) return busy()
    } else {
      const parent = await this.tool<{ record: Row<Competition> }>('records.get', { collection: 'competitions', recordId: input.competitionId })
      if (!parent.success || parent.data.record.createdBy !== userId) return unavailable()
      if (input.operation === 'removeCompetitor') {
        const target = await this.tool<{ record: Row<Competitor> }>('records.get', { collection: 'competitors', recordId: input.targetId })
        if (!target.success || target.data.record.data.competitionId !== input.competitionId) return unavailable()
      }
      if (input.operation === 'removeJudge') {
        if (input.targetId === userId) return unavailable()
        const target = await this.tool<{ record: Row<TeamMember> }>('records.get', {
          collection: 'team_members', recordId: assignmentRecordId(input.competitionId, input.targetId!),
        })
        if (!target.success || target.data.record.createdBy !== userId || target.data.record.data.teamId !== input.competitionId
          || target.data.record.data.UserId !== input.targetId) return unavailable()
      }
      const published = await this.tool('records.get', { collection: 'public_results', recordId: input.competitionId })
      if (!published.success && published.error !== RECORD_NOT_FOUND) return busy()
      job = { ...input, ownerId: userId, refreshPublic: published.success || !!await this.state.storage.get(PENDING + input.competitionId) }
      // Persist intent before deleting anything; a crash at any later step is recoverable.
      await this.scheduleRetry()
      await this.state.storage.put(key, job)
    }
    if (!await this.tryCleanup(job)) return busy()
    return Response.json({ success: true, data: { deleted: true } })
  }

  private async remove(collection: string, recordId: string): Promise<void> {
    const result = await this.tool('records.delete', { collection, recordId })
    if (!result.success && result.error !== RECORD_NOT_FOUND) throw new Error('Deletion failed')
  }

  private async removeMatching(collection: string, where: Record<string, string>): Promise<void> {
    // deleteWhere is bounded by the SDK. Drain every page without broad filters.
    for (;;) {
      const result = await this.tool<{ deleted: number }>('records.deleteWhere', { collection, where, limit: 100 })
      if (!result.success) throw new Error('Cascade failed')
      if (result.data.deleted < 100) return
    }
  }

  private async tryCleanup(job: Cleanup): Promise<boolean> {
    const { competitionId, operation, targetId } = job
    try {
      if (operation === 'removeJudge') {
        await this.remove('team_members', assignmentRecordId(competitionId, targetId!))
      } else {
        // Invalidate first: interrupted deletion must not leave a functioning stale
        // scoreboard. Competitor cleanup rebuilds it before reporting success.
        await this.remove('public_results', competitionId)
        await this.state.storage.delete(PENDING + competitionId)
        await this.removeMatching('scores', operation === 'removeCompetitor' ? { competitionId, competitorId: targetId! } : { competitionId })
        if (operation === 'removeCompetitor') {
          await this.remove('competitors', targetId!)
          if (job.refreshPublic && !await this.tryRefresh(competitionId)) throw new Error('Refresh pending')
        } else {
          await this.removeMatching('competitors', { competitionId })
          await this.removeMatching('team_members', { teamId: competitionId })
          await this.remove('competitions', competitionId)
        }
      }
      // Reconcile all clients on recovery too: a crash can occur after SQL delete
      // but before its normal SDK broadcast/resubscribe notification.
      for (const socket of this.state.getWebSockets()) this.sendLifecycleMessage(socket, serverBuild.resubscribe())
      await this.state.storage.delete(CLEANUP + competitionId)
      return true
    } catch {
      console.error('[lifecycle] Cleanup pending; durable alarm will retry.')
      await this.scheduleRetry()
      return false
    }
  }

  private sendLifecycleMessage(socket: WebSocket, message: unknown): void {
    try { if (socket.readyState === 1) socket.send(JSON.stringify(message)) } catch { /* Reconnect resubscribes. */ }
  }

  private async scheduleRetry(): Promise<void> {
    if (await this.state.storage.getAlarm() === null) await this.state.storage.setAlarm(Date.now() + RETRY_MS)
  }

  private async tool<T>(tool: string, params: Record<string, unknown>): Promise<ActionResult<T>> {
    // Fixed non-person identity prevents createdBy from leaking a judge/owner ID.
    const response = await super.fetch(new Request('https://internal/api/tools/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': SERVICE_ID, 'X-App-Action': 'true' },
      body: JSON.stringify({ tool, params }),
    }))
    return response.json() as Promise<ActionResult<T>>
  }

  private async markPending(competitionId: string): Promise<void> {
    // Schedule first: if the isolate stops between these awaits, no write has yet
    // happened. If it stops afterward, the pending marker has a recovery alarm.
    await this.scheduleRetry()
    await this.state.storage.put(PENDING + competitionId, true)
  }

  private async tryRefresh(competitionId: string): Promise<boolean> {
    try {
      const parent = await this.tool<{ record: Row<Competition> }>('records.get', { collection: 'competitions', recordId: competitionId })
      if (!parent.success && parent.error === RECORD_NOT_FOUND) {
        await this.remove('public_results', competitionId)
        await this.state.storage.delete(PENDING + competitionId)
        return true
      }
      const competitors = await this.tool<{ records: Row<Competitor>[] }>('records.query', { collection: 'competitors', where: { competitionId } })
      const scores = await this.tool<{ records: Row<Score>[] }>('records.query', { collection: 'scores', where: { competitionId } })
      if (!parent.success || !competitors.success || !scores.success) throw new Error('Projection input unavailable')
      const result = await this.tool('records.create', {
        collection: 'public_results', recordId: competitionId,
        data: buildPublicResults(parent.data.record.data.name, competitionId, competitors.data.records, scores.data.records),
      })
      if (!result.success) throw new Error('Projection write unavailable')
      await this.state.storage.delete(PENDING + competitionId)
      return true
    } catch {
      console.error('[public-results] Refresh pending; durable alarm will retry.')
      return false
    }
  }

  protected override async onAlarm(): Promise<void> {
    await this.serialize(async () => {
      const jobs = await this.state.storage.list<Cleanup>({ prefix: CLEANUP })
      let failed = false
      for (const job of jobs.values()) if (!await this.tryCleanup(job)) failed = true
      const pending = await this.state.storage.list<boolean>({ prefix: PENDING })
      for (const key of pending.keys()) {
        if (await this.state.storage.get(CLEANUP + key.slice(PENDING.length))) continue
        if (!await this.tryRefresh(key.slice(PENDING.length))) failed = true
      }
      if (failed) await this.state.storage.setAlarm(Date.now() + RETRY_MS)
    })
  }
}
