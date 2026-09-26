import { expect, it } from 'vitest'
import { competitionDestination } from './competition-navigation'

const accessible = { recordId: 'competition/a b', createdBy: 'owner' }

it('routes the organizer to management', () => {
  expect(competitionDestination(accessible, 'owner')).toBe('/competitions/competition%2Fa%20b')
})
it('routes an authorized non-owner directly to judging, also used for detail redirects', () => {
  expect(competitionDestination(accessible, 'judge')).toBe('/competitions/competition%2Fa%20b/judge')
})
it('offers no destination when the server returns no accessible record', () => {
  expect(competitionDestination(undefined, 'unrelated')).toBeNull()
})
it.each([null, undefined, ''])('offers no destination without an authenticated identity: %s', (userId) => {
  expect(competitionDestination(accessible, userId)).toBeNull()
})
