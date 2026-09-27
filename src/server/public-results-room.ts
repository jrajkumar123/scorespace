import { RecordRoom, type ActionResult } from 'deepspace/worker'
import { buildPublicResults } from '../lib/public-results'
import type { Competition } from '../schemas/competitions-schema'
import type { Competitor } from '../schemas/competitors-schema'
import type { Score } from '../schemas/scores-schema'

type Row<T> = { recordId: string; createdBy: string; data: T }
const PENDING = 'public-results:pending:'
const SERVICE_ID = 'scorespace-public-service'
const RETRY_MS = 30_000

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

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    const privileged = request.headers.get('X-App-Action') === 'true'
    if (path === '/internal/public-results/publish') {
      if (request.method !== 'POST' || !privileged || !request.headers.get('X-User-Id')) {
        return Response.json({ success: false, error: 'Permission denied.' }, { status: 403 })
      }
      const { competitionId } = await request.json() as { competitionId?: unknown }
      if (typeof competitionId !== 'string' || !competitionId) {
        return Response.json({ success: false, error: 'A competition is required.' }, { status: 400 })
      }
      return this.serialize(async () => {
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
      const body = await request.clone().json() as { tool?: string; params?: { collection?: string; data?: { competitionId?: string } } }
      const { tool, params } = body
      // The current product only creates/upserts immutable scores and competitors.
      // Their direct client writes are denied; only authenticated actions reach here.
      if (tool === 'records.create' && (params?.collection === 'scores' || params?.collection === 'competitors')
        && typeof params.data?.competitionId === 'string') {
        const competitionId = params.data.competitionId
        return this.serialize(async () => {
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
    if (await this.state.storage.getAlarm() === null) await this.state.storage.setAlarm(Date.now() + RETRY_MS)
    await this.state.storage.put(PENDING + competitionId, true)
  }

  private async tryRefresh(competitionId: string): Promise<boolean> {
    try {
      const parent = await this.tool<{ record: Row<Competition> }>('records.get', { collection: 'competitions', recordId: competitionId })
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
      const pending = await this.state.storage.list<boolean>({ prefix: PENDING })
      let failed = false
      for (const key of pending.keys()) {
        if (!await this.tryRefresh(key.slice(PENDING.length))) failed = true
      }
      if (failed) await this.state.storage.setAlarm(Date.now() + RETRY_MS)
    })
  }
}
