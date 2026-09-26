import type { CollectionSchema } from 'deepspace/schema'

export type TeamMember = { teamId: string; UserId: string; status: 'active' }

// DeepSpace team permissions resolve this collection's teamId/userId/status SQL
// columns. 0.33.1's resubscribe notification specifically reads data.UserId.
export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'UserId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'status', storage: 'text', interpretation: 'plain', required: true, immutable: true },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}
