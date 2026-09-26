import { useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAuthToken, useAuth, useQuery } from 'deepspace'
import { Button, EmptyState, Input, Label } from '@/components/ui'
import type { Competition } from '@/schemas/competitions-schema'
import type { Competitor } from '@/schemas/competitors-schema'
import type { Score } from '@/schemas/scores-schema'

export default function JudgingPage() {
  const { competitionId } = useParams<{ competitionId: string }>()
  return (
    <section className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <Link className="text-sm underline underline-offset-4"
        to={competitionId ? `/competitions/${encodeURIComponent(competitionId)}` : '/home'}>Back to competition</Link>
      {competitionId ? <JudgingCompetition key={competitionId} competitionId={competitionId} />
        : <p role="alert">Competition not found or unavailable.</p>}
    </section>
  )
}

function JudgingCompetition({ competitionId }: { competitionId: string }) {
  const { records, status, error } = useQuery<Competition>('competitions', { where: { recordId: competitionId } })
  if (status === 'loading') return <p role="status">Loading competition…</p>
  if (status === 'error') return <p role="alert">Could not load competition: {error ?? 'Connection unavailable.'}</p>
  const competition = records[0]
  if (!competition) return <p role="alert">Competition not found or unavailable.</p>
  return (
    <>
      <h1 className="break-words text-3xl font-semibold">Judge {competition.data.name}</h1>
      <p className="text-muted-foreground">Submit one score from 1 to 10 per competitor. Decimals are allowed. Submitted scores cannot be changed.</p>
      <JudgingList competitionId={competition.recordId} />
    </>
  )
}

function JudgingList({ competitionId }: { competitionId: string }) {
  const competitors = useQuery<Competitor>('competitors', { where: { competitionId }, orderBy: 'createdAt', orderDir: 'asc' })
  const { userId } = useAuth()
  // Organizer can read all scores, but this screen must show only their own.
  // For other judges the room also enforces author-only visibility.
  const scores = useQuery<Score>('scores', { where: { competitionId, createdBy: userId } })
  if (competitors.status === 'error' || scores.status === 'error') {
    return <p role="alert">Could not load judging data: {competitors.error ?? scores.error ?? 'Connection unavailable.'}</p>
  }
  if (competitors.status !== 'ready' || scores.status !== 'ready') return <p role="status">Loading competitors and scores…</p>
  if (!competitors.records.length) return <EmptyState title="No competitors yet" description="The organizer has not added competitors yet." />
  const scoresByCompetitor = new Map(scores.records.map((score) => [score.data.competitorId, score.data.value]))
  return (
    <ul aria-label="Judging competitors" className="space-y-4">
      {competitors.records.map((competitor) => (
        <li key={competitor.recordId} className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="break-words text-lg font-semibold">{competitor.data.name}</h2>
          <ScoreForm competitionId={competitionId} competitorId={competitor.recordId}
            competitorName={competitor.data.name} submittedScore={scoresByCompetitor.get(competitor.recordId)} />
        </li>
      ))}
    </ul>
  )
}

function ScoreForm({ competitionId, competitorId, competitorName, submittedScore }: {
  competitionId: string; competitorId: string; competitorName: string; submittedScore?: number
}) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const numericValue = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(numericValue) && numericValue >= 1 && numericValue <= 10

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !valid || accepted || submittedScore !== undefined) return
    submitting.current = true
    setSaving(true)
    setError(null)
    try {
      const token = await getAuthToken()
      if (!token) throw new Error('Please sign in again to submit a score.')
      const response = await fetch('/api/actions/submitScore', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ competitionId, competitorId, value: numericValue }),
      })
      if (!response.ok) throw new Error('Could not confirm submission. Retry the same score if needed.')
      const result: { success: boolean; error?: string } = await response.json()
      if (!result.success) throw new Error(result.error ?? 'Could not submit score.')
      // Only acknowledgment state is local. The displayed value comes from useQuery.
      setAccepted(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm submission. Retry the same score if needed.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  if (submittedScore !== undefined) return <p role="status">Your submitted score: <strong>{submittedScore}</strong> / 10</p>
  if (accepted) return <p role="status">Score saved. Waiting for synchronized score…</p>
  return (
    <form onSubmit={submit} className="space-y-3">
      <Label htmlFor={`score-${competitorId}`}>Score for {competitorName}</Label>
      <div className="flex flex-wrap items-center gap-3">
        <Input id={`score-${competitorId}`} className="max-w-40" type="number" min="1" max="10" step="any"
          required value={value} disabled={saving} onChange={(event) => setValue(event.target.value)}
          aria-describedby={error ? `error-${competitorId}` : undefined} />
        <Button type="submit" loading={saving} disabled={!valid}>{saving ? 'Submitting…' : 'Submit Score'}</Button>
      </div>
      {error && <p id={`error-${competitorId}`} role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  )
}
