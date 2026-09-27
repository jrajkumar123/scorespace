import { useId, useRef, useState, type FormEvent } from 'react'
import { getAuthToken } from 'deepspace'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, useToast } from '@/components/ui'
import type { LifecycleOperation } from '@/actions/lifecycle'

/** Confirmation only. Authorization and cascade semantics belong to the server. */
export function LifecycleAction({ action, params, label, description, confirmationName, onSuccess }: {
  action: LifecycleOperation
  params: { competitionId: string; competitorId?: string; judgeId?: string }
  label: string
  description: string
  confirmationName?: string
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const inputId = useId()
  const toast = useToast()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || (confirmationName !== undefined && confirmation !== confirmationName)) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      const token = await getAuthToken()
      if (!token) throw new Error('Please sign in again.')
      const response = await fetch(`/api/actions/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      const result: { success: boolean; error?: string } = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error ?? 'Could not complete removal. Please retry.')
      setOpen(false)
      toast.success(action === 'deleteCompetition' ? 'Competition deleted' : action === 'removeJudge' ? 'Judge removed; accepted scores preserved' : 'Competitor and scores removed')
      onSuccess?.()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not complete removal. Please retry.'
      setError(message)
      // A synchronized deletion can unmount the row before the HTTP response.
      // A global toast still reports pending cleanup/failure in that case.
      toast.error('Removal not confirmed', message)
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return <>
    <Button variant="ghost" className="text-destructive" size="sm" onClick={() => {
      setError(null); setConfirmation(''); setOpen(true)
    }}>{label}</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!submitting.current) setOpen(next) }}>
      <DialogContent hideClose={pending}>
        <DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {confirmationName !== undefined && <div className="space-y-2">
            <Label htmlFor={inputId}>Type the competition name to confirm</Label>
            <Input id={inputId} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={pending} autoComplete="off" required />
          </div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" loading={pending}
              disabled={confirmationName !== undefined && confirmation !== confirmationName}>{pending ? 'Removing…' : label}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>
}
