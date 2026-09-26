import { useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAuthToken, useQuery } from 'deepspace'
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, EmptyState, Input, Label, useToast,
} from '@/components/ui'
import type { Competition } from '@/schemas/competitions-schema'
import type { Competitor } from '@/schemas/competitors-schema'

export default function CompetitionPage() {
  const { competitionId } = useParams<{ competitionId: string }>()
  return (
    <section className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <Link to="/home" className="text-sm underline underline-offset-4">Back to dashboard</Link>
      {competitionId ? <CompetitionDetail key={competitionId} competitionId={competitionId} />
        : <p role="alert">Competition not found or unavailable.</p>}
    </section>
  )
}

function CompetitionDetail({ competitionId }: { competitionId: string }) {
  const { records, status, error } = useQuery<Competition>('competitions', {
    where: { recordId: competitionId },
  })
  if (status === 'loading') return <p role="status">Loading competition…</p>
  if (status === 'error') return <p role="alert">Could not load competition: {error ?? 'Connection unavailable.'}</p>
  const competition = records[0]
  if (!competition) return <p role="alert">Competition not found or unavailable.</p>

  return (
    <>
      <h1 className="break-words text-3xl font-semibold">{competition.data.name}</h1>
      <Competitors competitionId={competition.recordId} />
    </>
  )
}

function Competitors({ competitionId }: { competitionId: string }) {
  // This filter selects the parent; the collection's 'own' rule enforces privacy.
  const { records, status, error } = useQuery<Competitor>('competitors', {
    where: { competitionId }, orderBy: 'createdAt', orderDir: 'asc',
  })
  const { success } = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitting = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !name.trim()) return
    submitting.current = true
    setSaving(true)
    setSubmitError(null)
    try {
      const token = await getAuthToken()
      if (!token) throw new Error('Please sign in again to add a competitor.')
      // Unlike a direct mutation, this action checks ownership of the parent.
      const response = await fetch('/api/actions/addCompetitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ competitionId, name: name.trim() }),
      })
      if (!response.ok) throw new Error('Could not add competitor. Please try again.')
      const result: { success: boolean; error?: string } = await response.json()
      if (!result.success) throw new Error(result.error ?? 'Could not add competitor.')
      // Success confirms persistence; useQuery supplies the row via the broadcast.
      setOpen(false)
      setName('')
      success('Competitor added')
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not add competitor. Please try again.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Competitors</h2>
        <Button disabled={status !== 'ready'} onClick={() => { setSubmitError(null); setOpen(true) }}>Add Competitor</Button>
      </div>
      {status === 'loading' && <p role="status">Loading competitors…</p>}
      {status === 'error' && <p role="alert" className="text-destructive">Could not load competitors: {error ?? 'Connection unavailable.'}</p>}
      {status === 'ready' && records.length === 0 && (
        <EmptyState title="No competitors yet" description="Add the first competitor to this competition." />
      )}
      {records.length > 0 && (
        <ul aria-label="Competitors" className="space-y-3">
          {records.map((competitor) => (
            <li key={competitor.recordId} className="break-words rounded-lg border border-border bg-card p-5">{competitor.data.name}</li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!submitting.current) setOpen(nextOpen) }}>
        <DialogContent hideClose={saving}>
          <DialogHeader>
            <DialogTitle>Add Competitor</DialogTitle>
            <DialogDescription>Add a competitor to this competition.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="competitor-name">Competitor name</Label>
              <Input id="competitor-name" value={name} onChange={(event) => setName(event.target.value)}
                required disabled={saving} aria-invalid={!!submitError}
                aria-describedby={submitError ? 'competitor-error' : undefined} />
            </div>
            {submitError && <p id="competitor-error" role="alert" className="text-sm text-destructive">{submitError}</p>}
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={status !== 'ready' || !name.trim()}>
                {saving ? 'Adding…' : 'Add Competitor'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
