import { expect, it } from 'vitest'
import { deriveStandings, formatResultScore } from './standings'

const competitor = (recordId: string, name: string, competitionId = 'competition-a') => ({
  recordId, data: { name, competitionId },
})
const score = (competitorId: string, value: number, competitionId = 'competition-a') => ({
  data: { competitorId, competitionId, value },
})

it('returns empty standings for an empty competition', () => {
  expect(deriveStandings('competition-a', [], [])).toEqual([])
})

it('puts scored competitors first in descending numeric order and leaves unscored competitors unranked', () => {
  const rows = deriveStandings('competition-a', [
    competitor('a', 'Ada'), competitor('b', 'Bob'), competitor('c', 'Clara'), competitor('d', 'Dana'),
  ], [score('a', 8.25), score('c', 1), score('b', 10)])
  expect(rows).toEqual([
    { competitorId: 'b', name: 'Bob', score: 10, scoreCount: 1, rank: 1, tied: false },
    { competitorId: 'a', name: 'Ada', score: 8.25, scoreCount: 1, rank: 2, tied: false },
    { competitorId: 'c', name: 'Clara', score: 1, scoreCount: 1, rank: 3, tied: false },
    { competitorId: 'd', name: 'Dana', score: null, scoreCount: 0, rank: null, tied: false },
  ])
})

it('uses competition ranking and deterministic name then ID ordering without breaking ties', () => {
  const competitors = [competitor('c', 'Bob'), competitor('b', 'Ada'), competitor('a', 'Ada'), competitor('d', 'Dana')]
  const scores = [score('a', 9), score('b', 9), score('c', 8), score('d', 7)]
  const rows = deriveStandings('competition-a', competitors, scores)
  expect(rows.map(({ competitorId, rank, tied }) => [competitorId, rank, tied])).toEqual([
    ['a', 1, true], ['b', 1, true], ['c', 3, false], ['d', 4, false],
  ])
  expect(deriveStandings('competition-a', [...competitors].reverse(), [...scores].reverse())).toEqual(rows)
})

it('handles multiple tied groups and gives all equal scores the same rank', () => {
  const competitors = ['a', 'b', 'c', 'd', 'e'].map((id) => competitor(id, id))
  const scores = [score('a', 10), score('b', 9), score('c', 9), score('d', 8), score('e', 8)]
  expect(deriveStandings('competition-a', competitors, scores).map(({ rank }) => rank)).toEqual([1, 2, 2, 4, 4])
  expect(deriveStandings('competition-a', competitors, competitors.map(({ recordId }) => score(recordId, 9)))
    .every(({ rank, tied }) => rank === 1 && tied)).toBe(true)
})

it('orders entirely unscored competitors by name then ID with no ranks or ties', () => {
  const rows = deriveStandings('competition-a', [competitor('c', 'Bob'), competitor('b', 'Ada'), competitor('a', 'Ada')], [])
  expect(rows.map(({ competitorId }) => competitorId)).toEqual(['a', 'b', 'c'])
  expect(rows.every(({ score: value, rank, tied }) => value === null && rank === null && !tied)).toBe(true)
})

it('ignores other competitions and scores with no competitor in this competition', () => {
  const rows = deriveStandings('competition-a', [competitor('a', 'Ada'), competitor('b', 'Bob', 'competition-b')], [
    score('a', 10, 'competition-b'), score('b', 9, 'competition-b'), score('missing', 8),
  ])
  expect(rows).toEqual([{ competitorId: 'a', name: 'Ada', score: null, scoreCount: 0, rank: null, tied: false }])
})

it('recalculates from new query inputs without mutating earlier inputs or standings', () => {
  const competitors = Object.freeze([Object.freeze(competitor('a', 'Ada')), Object.freeze(competitor('b', 'Bob'))])
  const before = deriveStandings('competition-a', competitors, Object.freeze([]))
  const after = deriveStandings('competition-a', competitors, Object.freeze([Object.freeze(score('b', 8.25))]))
  expect(before.every(({ score: value }) => value === null)).toBe(true)
  expect(after.map(({ competitorId }) => competitorId)).toEqual(['b', 'a'])
  expect(competitors.map(({ recordId }) => recordId)).toEqual(['a', 'b'])
})

it('does not round close scores into a false tie', () => {
  const rows = deriveStandings('competition-a', [competitor('a', 'Ada'), competitor('b', 'Bob')], [score('a', 8.251), score('b', 8.252)])
  expect(rows.map(({ rank, tied }) => [rank, tied])).toEqual([[1, false], [2, false]])
  expect(rows.map(({ score: value }) => formatResultScore(value!))).toEqual(['8.252', '8.251'])
})

it.each([[1, '1.0'], [10, '10.0'], [8.25, '8.25'], [9.5, '9.5']])('formats %s as %s', (value, expected) => {
  expect(formatResultScore(value as number)).toBe(expected)
})

it('averages multiple judges and ranks equal averages with different counts together', () => {
  const competitors = [competitor('a', 'Ada'), competitor('b', 'Bob'), competitor('c', 'Clara')]
  const scores = [score('a', 8), score('a', 9.5), score('b', 8.75)]
  const rows = deriveStandings('competition-a', competitors, scores)
  expect(rows.map(({ score, scoreCount, rank, tied }) => [score, scoreCount, rank, tied]))
    .toEqual([[8.75, 2, 1, true], [8.75, 1, 1, true], [null, 0, null, false]])
  expect(deriveStandings('competition-a', competitors, [...scores].reverse())).toEqual(rows)
})
