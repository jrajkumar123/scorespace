import type { CollectionSchema } from 'deepspace/schema'

export type Competition = { name: string }

export const competitionsSchema: CollectionSchema = {
  name: 'competitions',
  teamField: 'competitionId',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    // Computed, never client-writable: works in both team queries and broadcasts.
    { name: 'competitionId', storage: 'text', interpretation: 'plain', expression: '_row_id' },
  ],
  // Team access includes the creator and explicitly assigned judges.
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'team', create: true, update: false, delete: false },
    admin: { read: 'team', create: true, update: false, delete: false },
  },
}
