import { expect, it } from 'vitest'
import { buildPublicResults } from './public-results'

it('publishes only aggregate/display fields, with ties, counts, and unscored ordering', () => {
  const competitors = ['Ada', 'Bob', 'Clara'].map((name) => ({ recordId: `private-${name}`, data: { name, competitionId: 'c' } }))
  const scores = [8, 10].map((value, index) => ({ recordId: `secret-score-${index}`, createdBy: `secret-judge-${index}`,
    data: { competitionId: 'c', competitorId: 'private-Ada', value, organizerAccess: '["owner"]' } }))
  scores.push({ recordId: 'secret-score-3', createdBy: 'secret-judge-3', data: { competitionId: 'c', competitorId: 'private-Bob', value: 9, organizerAccess: '["owner"]' } })
  const result = buildPublicResults('Competition', 'c', competitors, scores)
  expect(result).toEqual({ name: 'Competition', entries: [
    { name: 'Ada', score: 9, scoreCount: 2, rank: 1, tied: true },
    { name: 'Bob', score: 9, scoreCount: 1, rank: 1, tied: true },
    { name: 'Clara', score: null, scoreCount: 0, rank: null, tied: false },
  ] })
  expect(JSON.stringify(result)).not.toMatch(/secret|private-|organizerAccess|createdBy|competitorId/)
})
it('handles a published competition without competitors', () => {
  expect(buildPublicResults('Empty', 'c', [], [])).toEqual({ name: 'Empty', entries: [] })
})
