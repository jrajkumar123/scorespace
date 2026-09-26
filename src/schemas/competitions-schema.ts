import type { CollectionSchema } from 'deepspace/schema'

export type Competition = { name: string }

export const competitionsSchema: CollectionSchema = {
  name: 'competitions',
  columns: [{ name: 'name', storage: 'text', interpretation: 'plain', required: true }],
  // 'own' checks the server-assigned createdBy metadata.
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: false, delete: false },
    admin: { read: 'own', create: true, update: false, delete: false },
  },
}
