import { Link, useParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { formatResultScore } from '@/lib/standings'
import type { PublicResults } from '@/schemas/public-results-schema'

export default function SpectatorPage() {
  const { competitionId } = useParams<{ competitionId: string }>()
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="text-xl font-semibold">ScoreSpace</Link>
        <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold tracking-widest">LIVE RESULTS</span>
      </header>
      {competitionId ? <Scoreboard competitionId={competitionId} />
        : <p role="alert">Public results are unavailable.</p>}
    </main>
  )
}

function Scoreboard({ competitionId }: { competitionId: string }) {
  const { records, status, error } = useQuery<PublicResults>('public_results', { where: { recordId: competitionId } })
  if (status === 'loading') return <p role="status">Connecting to live results…</p>
  if (status === 'error') return <p role="alert">Could not load live results: {error ?? 'Connection unavailable.'}</p>
  const results = records[0]?.data
  if (!results) return <p role="alert">Public results are unavailable. Check the link or ask the organizer to enable them.</p>
  return (
    <>
      <div className="space-y-2">
        <h1 className="break-words text-3xl font-semibold sm:text-4xl">{results.name}</h1>
        <p className="text-sm text-muted-foreground">Updates automatically as scores arrive. Equal averages share a rank.</p>
      </div>
      {!results.entries.length ? <p>No competitors yet. Results will appear here when the organizer adds them.</p> : (
        <ol aria-label="Live leaderboard" className="space-y-3">
          {results.entries.map((entry, index) => (
            <li key={index} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:p-6">
              <span className="text-2xl font-semibold tabular-nums" aria-label={entry.rank === null ? 'Unranked' : `Rank ${entry.rank}${entry.tied ? ', tied' : ''}`}>
                {entry.rank === null ? '—' : `#${entry.rank}`}
              </span>
              <div className="min-w-0">
                <h2 className="break-words text-lg font-medium">{entry.name}</h2>
                <p className="text-sm text-muted-foreground">{entry.scoreCount} {entry.scoreCount === 1 ? 'score' : 'scores'}{entry.tied ? ' · tied' : ''}</p>
              </div>
              <div className="col-start-2 break-all text-2xl font-semibold tabular-nums sm:col-start-auto sm:text-right">
                {entry.score === null ? <span className="text-base font-normal text-muted-foreground">Not scored</span>
                  : <>{formatResultScore(entry.score)} <span className="text-sm font-normal text-muted-foreground">/ 10</span></>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
