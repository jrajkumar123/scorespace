type AccessibleCompetition = { recordId: string; createdBy: string }

// Pass only a record returned by the permission-filtered query. This chooses a
// destination, not access: the room and server actions remain the authority.
export function competitionDestination(
  competition: AccessibleCompetition | undefined,
  userId: string | null | undefined,
): string | null {
  if (!competition || !userId) return null
  const detail = `/competitions/${encodeURIComponent(competition.recordId)}`
  return competition.createdBy === userId ? detail : `${detail}/judge`
}
