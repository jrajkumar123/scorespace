import type { Competitor } from '../schemas/competitors-schema'
import type { Score } from '../schemas/scores-schema'

type CompetitorRecord = { recordId: string; data: Competitor }
type ScoreRecord = { data: Score }

export type Standing = {
  competitorId: string
  name: string
  score: number | null
  scoreCount: number
  rank: number | null
  tied: boolean
}

// Explicit string ordering stays the same across browsers/locales.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function deriveStandings(
  competitionId: string,
  competitors: readonly CompetitorRecord[],
  scores: readonly ScoreRecord[],
): Standing[] {
  const valuesByCompetitor = new Map<string, number[]>()
  for (const { data } of scores) {
    if (data.competitionId !== competitionId) continue
    const values = valuesByCompetitor.get(data.competitorId) ?? []
    values.push(data.value)
    valuesByCompetitor.set(data.competitorId, values)
  }
  const standings: Standing[] = competitors
    .filter(({ data }) => data.competitionId === competitionId)
    .map(({ recordId, data }) => {
      // Sorting fixes addition order across query/broadcast arrival orders.
      // IEEE-754 arithmetic, no rounding for ranking or display.
      const values = (valuesByCompetitor.get(recordId) ?? []).sort((a, b) => a - b)
      return {
        competitorId: recordId, name: data.name,
        score: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        scoreCount: values.length, rank: null, tied: false,
      }
    })

  standings.sort((a, b) => {
    if (a.score === null && b.score !== null) return 1
    if (a.score !== null && b.score === null) return -1
    if (a.score !== null && b.score !== null && a.score !== b.score) return b.score - a.score
    return compareText(a.name, b.name) || compareText(a.competitorId, b.competitorId)
  })

  // Competition ranking: equal scores share a rank; the next rank skips places.
  // Example: 9, 9, 8 becomes 1, 1, 3. Name ordering never breaks a numeric tie.
  standings.forEach((standing, index) => {
    if (standing.score === null) return
    const previous = standings[index - 1]
    const sameAsPrevious = previous?.score === standing.score
    standing.rank = sameAsPrevious ? previous.rank : index + 1
    standing.tied = sameAsPrevious || standings[index + 1]?.score === standing.score
  })
  return standings
}

// Don't round different submitted values into an apparent tie.
export function formatResultScore(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value)
}
