import type { CollectionSchema } from 'deepspace/schema'

export type Competitor = { name: string; competitionId: string }

export const competitorsSchema: CollectionSchema = {
  name: 'competitors',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'competitionId', storage: 'text', required: true, immutable: true,
      interpretation: { kind: 'reference', targetTable: 'competitions', displayColumn: 'name' },
    },
  ],
  // Only addCompetitor may create rows, after checking parent ownership.
  // It creates as the caller, so createdBy matches the competition owner.
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}
