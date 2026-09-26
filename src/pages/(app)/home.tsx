import { useRef, useState, type FormEvent } from 'react'
import { AuthGate, useMutations, useQuery } from 'deepspace'
import { Link } from 'react-router-dom'
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, EmptyState, Input, Label, useToast,
} from '@/components/ui'
import type { Competition } from '@/schemas/competitions-schema'

export default function HomePage() {
  return <AuthGate><CompetitionDashboard /></AuthGate>
}

function CompetitionDashboard() {
  // Ownership is enforced by the room, not a browser-side filter.
  const { records, status, error } = useQuery<Competition>('competitions', {
    orderBy: 'createdAt', orderDir: 'desc',
  })
  const { createConfirmed, ready } = useMutations<Competition>('competitions')
  const { success } = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitting = useRef(false)

  async function createCompetition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setSubmitError('Enter a competition name.')
      return
    }
    submitting.current = true
    setSaving(true)
    setSubmitError(null)
    try {
      await createConfirmed({ name: trimmedName })
      // The synchronized query supplies the new row; no local list or refetch.
      setOpen(false)
      setName('')
      success('Competition created')
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not create competition. Please try again.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">ScoreSpace</h1>
          <p className="mt-2 text-muted-foreground">Your competitions, in one place.</p>
        </div>
        <Button disabled={!ready} onClick={() => { setSubmitError(null); setOpen(true) }}>
          Create Competition
        </Button>
      </header>
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">My competitions</h2>
        {status === 'loading' && <p role="status">Loading competitions…</p>}
        {status === 'error' && <p role="alert" className="text-destructive">Could not load competitions: {error ?? 'Connection unavailable.'}</p>}
        {status === 'ready' && records.length === 0 && (
          <EmptyState title="No competitions yet" description="Create your first competition to get started." />
        )}
        {records.length > 0 && (
          <ul className="space-y-3" aria-label="My competitions">
            {records.map((competition) => (
              <li key={competition.recordId} className="break-words rounded-lg border border-border bg-card">
                <Link className="block rounded-lg p-5 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  to={`/competitions/${encodeURIComponent(competition.recordId)}`}>
                  {competition.data.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!submitting.current) setOpen(nextOpen) }}>
        <DialogContent hideClose={saving}>
          <DialogHeader>
            <DialogTitle>Create Competition</DialogTitle>
            <DialogDescription>Give your competition a name. Only you can see it.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createCompetition} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="competition-name">Competition name</Label>
              <Input id="competition-name" value={name} onChange={(event) => setName(event.target.value)}
                required disabled={saving} aria-invalid={!!submitError}
                aria-describedby={submitError ? 'competition-error' : undefined} />
            </div>
            {submitError && <p id="competition-error" role="alert" className="text-sm text-destructive">{submitError}</p>}
            {!ready && <p role="status" className="text-sm text-muted-foreground">Waiting for connection…</p>}
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving} disabled={!ready || !name.trim()}>
                {saving ? 'Creating…' : 'Create Competition'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
