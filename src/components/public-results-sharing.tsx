import { useRef, useState } from 'react'
import { getAuthToken, useQuery } from 'deepspace'
import { Button, Input, Label, useToast } from '@/components/ui'
import type { PublicResults } from '@/schemas/public-results-schema'

export function PublicResultsSharing({ competitionId }: { competitionId: string }) {
  const { records, status, error } = useQuery<PublicResults>('public_results', { where: { recordId: competitionId } })
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitting = useRef(false)
  const { success } = useToast()
  const path = `/live/${encodeURIComponent(competitionId)}`
  const url = typeof window === 'undefined' ? path : `${window.location.origin}${path}`

  async function publish() {
    if (submitting.current) return
    submitting.current = true
    setSaving(true)
    setSubmitError(null)
    try {
      const token = await getAuthToken()
      if (!token) throw new Error('Please sign in again.')
      const response = await fetch('/api/actions/publishResults', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ competitionId }),
      })
      const result: { success?: boolean; error?: string } = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error ?? 'Could not enable public results. Please retry.')
      success('Public results enabled')
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not enable public results.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      success('Public link copied')
    } catch {
      setSubmitError('Could not copy automatically. Select and copy the link below.')
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-5">
      <h2 className="text-lg font-semibold">Public Results</h2>
      <p className="text-sm text-muted-foreground">Publish competition and competitor names, live averages, and score counts for anyone to view. Judge identities and individual score records stay private.</p>
      {status === 'loading' && <p role="status">Loading public link…</p>}
      {status === 'error' && <p role="alert">Could not load public link: {error}</p>}
      {status === 'ready' && (records.length ? (
        <div className="space-y-3">
          <Label htmlFor="public-results-url">Public results URL</Label>
          <Input id="public-results-url" readOnly value={url} onFocus={(event) => event.target.select()} />
          <div className="flex flex-wrap gap-3">
            <a className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" href={path} target="_blank" rel="noreferrer">Open Spectator View</a>
            <Button variant="outline" onClick={copy}>Copy public link</Button>
          </div>
        </div>
      ) : <Button loading={saving} disabled={saving} onClick={publish}>Enable Public Results</Button>)}
      {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
    </section>
  )
}
