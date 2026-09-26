import { Link, useParams } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { EmptyState } from '@/components/ui'
import { deriveStandings, formatResultScore } from '@/lib/standings'
import type { Competition } from '@/schemas/competitions-schema'
import type { Competitor } from '@/schemas/competitors-schema'
import type { Score } from '@/schemas/scores-schema'

export default function ResultsPage() {
  const { competitionId } = useParams<{ competitionId: string }>()
  return (
    <section className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <Link className="text-sm underline underline-offset-4"
        to={competitionId ? `/competitions/${encodeURIComponent(competitionId)}` : '/home'}>Back to competition</Link>
      <h1 className="text-3xl font-semibold">Live Results</h1>
      {competitionId ? <CompetitionResults key={competitionId} competitionId={competitionId} />
        : <p role="alert">Competition not found or unavailable.</p>}
    </section>
  )
}

function CompetitionResults({ competitionId }: { competitionId: string }) {
  const { userId } = useAuth()
  const { records, status, error } = useQuery<Competition>('competitions', { where: { recordId: competitionId } })
  if (status === 'loading') return <p role="status">Loading competition…</p>
  if (status === 'error') return <p role="alert">Could not load competition: {error ?? 'Connection unavailable.'}</p>
  const competition = records[0]
  if (!competition || competition.createdBy !== userId) return <p role="alert">Competition not found or unavailable.</p>
  return (
    <>
      <h2 className="break-words text-xl font-semibold">{competition.data.name}</h2>
      <Standings competitionId={competition.recordId} />
    </>
  )
}

function Standings({ competitionId }: { competitionId: string }) {
  const competitors = useQuery<Competitor>('competitors', { where: { competitionId } })
  // Server-side collaborator permissions expose all scores only to the organizer.
  const scores = useQuery<Score>('scores', { where: { competitionId } })
  if (competitors.status === 'error' || scores.status === 'error') {
    return <p role="alert">Could not load results: {competitors.error ?? scores.error ?? 'Connection unavailable.'}</p>
  }
  // An unfinished score snapshot must not make competitors appear unscored.
  if (competitors.status !== 'ready' || scores.status !== 'ready') return <p role="status">Loading results…</p>
  if (!competitors.records.length) return <EmptyState title="No competitors yet" description="Return to the competition to add competitors." />

  // Derived on each query update. No persisted standings, polling, or local copy.
  const standings = deriveStandings(competitionId, competitors.records, scores.records)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Updates automatically as scores arrive. Equal averages share a rank. Averages use full numeric precision.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Competition standings</caption>
          <thead className="bg-muted">
            <tr>
              <th scope="col" className="px-4 py-3">Rank</th>
              <th scope="col" className="px-4 py-3">Competitor</th>
              <th scope="col" className="px-4 py-3 text-right">Average / 10</th>
              <th scope="col" className="px-4 py-3 text-right">Scores</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((standing) => (
              <tr key={standing.competitorId} className="border-t border-border">
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                  {standing.rank === null ? <span aria-label="Unranked">—</span>
                    : `${standing.rank}${standing.tied ? ' (tie)' : ''}`}
                </td>
                <th scope="row" className="break-words px-4 py-3 font-medium">{standing.name}</th>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {standing.score === null ? <span className="text-muted-foreground">Not scored</span>
                    : formatResultScore(standing.score)}
                </td>
                <td className="px-4 py-3 text-right">{standing.scoreCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
