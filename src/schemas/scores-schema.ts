import type { CollectionSchema } from 'deepspace/schema'

export type Score = { competitorId: string; competitionId: string; value: number }

export const scoresSchema: CollectionSchema = {
  name: 'scores',
  columns: [
    { name: 'competitorId', storage: 'text', required: true, immutable: true,
      interpretation: { kind: 'reference', targetTable: 'competitors', displayColumn: 'name' } },
    // Server-derived from the competitor, for a single competition-scoped subscription.
    { name: 'competitionId', storage: 'text', required: true, immutable: true,
      interpretation: { kind: 'reference', targetTable: 'competitions', displayColumn: 'name' } },
    { name: 'value', storage: 'number', interpretation: 'plain', required: true, immutable: true },
  ],
  // submitScore alone writes. Its deterministic ID and immutable value make retries safe.
  // createdBy is the judge identity; no duplicate judgeId column is needed.
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}
