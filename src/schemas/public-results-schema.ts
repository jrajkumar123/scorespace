import type { CollectionSchema } from 'deepspace/schema'

export type PublicStanding = {
  name: string
  score: number | null
  scoreCount: number
  rank: number | null
  tied: boolean
}
export type PublicResults = { name: string; entries: PublicStanding[] }

// These are deliberately public projections, never private score records.
// All writes go through the server's projection builder, including for admins.
export const publicResultsSchema: CollectionSchema = {
  name: 'public_results',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'entries', storage: 'text', interpretation: { kind: 'json' }, required: true },
  ],
  permissions: { '*': { read: true, create: false, update: false, delete: false } },
}
