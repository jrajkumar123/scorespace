# ScoreSpace submission draft

**What I built:** ScoreSpace is a small live competition judging app. Organizers
create competitions, add competitors, and authorize existing users as judges.
Judges submit one immutable score per competitor; organizers see live averages,
score counts, and tied standings. Organizers can publish a live spectator
scoreboard at `/live/:competitionId`, usable without signing in. Navigation
separates management, judging, and read-only spectating. Organizers can revoke
judges while preserving accepted scores, remove competitors with their scores,
and delete competitions with their associated private and public state.

**DeepSpace primitives:** Authentication, RecordProvider/RecordScope, persisted
RecordRoom records, synchronized useQuery subscriptions, confirmed competition
creation, server actions, the existing user roster, team permissions,
collaborator permissions, and an anonymous public-results query. The public
projection uses RecordRoom persistence/broadcasts plus Durable Object KV markers
and a failure-retry alarm, also used for resumable lifecycle cascades. SDK deletes
broadcast removals; membership changes refresh authorized queries. No third-party
API integrations were needed.

**Main tradeoff:** I kept scoring immutable and authorization explicit instead of
building invitations, score editing, or a full event-management product. Results
are derived from accepted scores. Spectators receive a server-generated aggregate
projection rather than raw judge records: names, averages, counts, and ranks are
public only after the organizer enables them. The organizer retains access to
raw scores; judges see only their own. This adds projection/recovery work but
preserves the privacy boundary. Averages can still reveal individual values
through count-1 or timing inference. Cascades are recoverable rather than atomic:
public results can briefly be unavailable during removal, and pending cleanup
blocks new writes until retry succeeds. There is no editing or unpublish workflow.

**Agent involvement:** A coding agent implemented substantial portions of the
application under my direction, including schemas, server actions, UI, tests,
role-aware navigation, the public aggregate projection and spectator page,
durable refresh/cascade recovery, lifecycle confirmations, documentation, and
security regression tests. I directed the
milestone scope and requested explanations so I could understand and modify the
implementation. This was not entirely hand-written by me.

**What I personally verified:** I manually verified the first milestone's
competition creation and synchronized own-competition dashboard. Before submitting,
replace the placeholders below with only checks I actually performed:

- [ ] Organizer creates competitors and authorizes an existing judge.
- [ ] Assigned judge gains access on an open dashboard without refresh.
- [ ] Organizer links open management; judge links/direct detail URLs open judging.
- [ ] Two separate users submit scores; open results update to the expected mean.
- [ ] Scores persist, remain immutable, and stay private from other judges.
- [ ] Unrelated users cannot access private competition data or submit scores.
- [ ] Enable public results, then open the spectator URL without authentication.
- [ ] Watch scores/competitors update on the public page without refreshing.
- [ ] Confirm public payloads contain no raw score records or judge identities.
- [ ] Revoke a judge: access disappears live, further scores fail, accepted scores remain.
- [ ] Remove a scored competitor: their scores/results disappear; others remain.
- [ ] Delete a competition: dashboard/judge access and public URL update; unrelated data remains.
- [ ] Deploy the final application deliberately and verify it at: **[live URL]**.

**Automated verification by the agent:** projection tests cover averages, ties,
ordering and sanitization. Installed-RecordRoom integration tests cover anonymous
permissions/broadcasts, concurrent writes, immutable retries and failed refresh
recovery after restart. Lifecycle tests cover ownership, revocation, cascades,
delayed-write races, and interruption recovery. Final command results will be
recorded after this pass finishes. The full authenticated lifecycle/spectator
browser flow and unchecked items above still need manual verification by me.

The spectator and lifecycle extensions are implemented locally and have not been deployed by the
agent. Replace this note and the live-URL placeholder only after deployment and
manual verification. The earlier deployed release does not include spectators.
