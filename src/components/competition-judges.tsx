import { useRef, useState, type FormEvent } from 'react'
import { getAuthToken, useAuth, useQuery, useUsers } from 'deepspace'
import { Button, Label, useToast } from '@/components/ui'
import type { TeamMember } from '@/schemas/team-members-schema'
import { LifecycleAction } from '@/components/lifecycle-action'

export function CompetitionJudges({ competitionId }: { competitionId: string }) {
  const { userId } = useAuth()
  const { users, usersLoaded } = useUsers()
  const assignments = useQuery<TeamMember>('team_members', { where: { teamId: competitionId } })
  const [judgeId, setJudgeId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const { success } = useToast()
  const assignedIds = new Set(assignments.records.map(({ data }) => data.UserId))
  const available = users.filter((user) => user.id !== userId && !assignedIds.has(user.id)
    && (user.role === 'member' || user.role === 'admin'))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !judgeId) return
    submitting.current = true
    setSaving(true)
    setError(null)
    try {
      const token = await getAuthToken()
      if (!token) throw new Error('Please sign in again.')
      const response = await fetch('/api/actions/addJudge', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ competitionId, judgeId }),
      })
      if (!response.ok) throw new Error('Could not authorize judge. Please retry.')
      const result: { success: boolean; error?: string } = await response.json()
      if (!result.success) throw new Error(result.error ?? 'Could not authorize judge.')
      setJudgeId('')
      success('Judge authorized')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not authorize judge.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Judges</h2>
      <p className="text-sm text-muted-foreground">You can judge as the organizer. Authorize other existing members below.</p>
      {assignments.status === 'loading' && <p role="status">Loading judges…</p>}
      {assignments.status === 'error' && <p role="alert">Could not load judges: {assignments.error}</p>}
      {assignments.status === 'ready' && !assignments.records.length && <p>No additional judges yet.</p>}
      <ul aria-label="Authorized judges" className="space-y-2">
        {assignments.records.map(({ recordId, data }) => (
          <li key={recordId} className="flex flex-wrap items-center justify-between gap-3 break-words rounded-lg border border-border p-3">
            <span>{users.find((user) => user.id === data.UserId)?.name || 'User'} · {data.UserId}</span>
            <LifecycleAction action="removeJudge" params={{ competitionId, judgeId: data.UserId }} label="Remove Judge"
              description={`Remove ${users.find((user) => user.id === data.UserId)?.name || data.UserId} as a judge? They will lose access to this competition. Scores they already submitted will be preserved.`} />
          </li>
        ))}
      </ul>
      {!usersLoaded && <p role="status">Loading available users…</p>}
      {usersLoaded && !available.length && <p>No other eligible users available. Users must sign in to ScoreSpace first.</p>}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="judge-user">Existing user</Label>
          <select id="judge-user" className="block max-w-full rounded-lg border border-border bg-background p-2"
            value={judgeId} onChange={(event) => setJudgeId(event.target.value)}
            disabled={saving || !usersLoaded || assignments.status !== 'ready'} required>
            <option value="">Select a user</option>
            {available.map((user) => <option key={user.id} value={user.id}>{user.name || 'User'} · {user.id}</option>)}
          </select>
        </div>
        <Button type="submit" loading={saving} disabled={!judgeId || !usersLoaded || assignments.status !== 'ready'}>Add Judge</Button>
      </form>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </section>
  )
}
