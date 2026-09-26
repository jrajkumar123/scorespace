# ScoreSpace submission draft

**What I built:** ScoreSpace is a small live competition judging app. Organizers
create competitions, add competitors, and authorize existing users as judges.
Judges submit one immutable score per competitor; organizers see live averages,
score counts, and tied standings. Navigation distinguishes management from judging.

**DeepSpace primitives:** Authentication, RecordProvider/RecordScope, persisted
RecordRoom records, synchronized useQuery subscriptions, confirmed competition
creation, server actions, the existing user roster, team permissions, and
collaborator permissions. No third-party API integrations were needed.

**Main tradeoff:** I kept scoring immutable and authorization explicit instead of
building invitations, score editing, or a full event-management product. Results
are derived from accepted scores instead of storing a second leaderboard. The
organizer sees all scores; judges see only their own. This keeps the exercise
small enough to explain and test, at the cost of no correction/revocation workflow.

**Agent involvement:** A coding agent implemented substantial portions of the
application under my direction, including schemas, server actions, UI, tests,
role-aware navigation, documentation, and a final security audit. I directed the
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
- [ ] Unrelated users cannot access competition data or submit scores.
- [ ] Deployed app works with authenticated users at: **[verified live URL]**.

Automated checks run by the agent are separate from my manual verification.
Authenticated browser tests that skip for missing test accounts are not proof
of the complete browser flow. Use the final milestone report for actual check
results and deployment status; do not claim those placeholders are complete.
