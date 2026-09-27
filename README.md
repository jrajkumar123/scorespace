# ScoreSpace

A small live competition judging app built with React, TypeScript, and DeepSpace.
An organizer creates a competition, adds competitors, authorizes existing users
as judges, and watches average scores update as judges submit. Organizers can also enable
a public, realtime spectator scoreboard and manage judge revocation, competitor
removal, and competition deletion.

## Using it

1. Open the dashboard and sign in with DeepSpace authentication.
2. Create a competition. Its creator is its organizer.
3. Add competitors and select existing ScoreSpace users in the Judges section.
   A user must have signed in to this app before appearing in the roster.
4. Organizers open management from their dashboard. Assigned judges go straight
   to `/competitions/:competitionId/judge`; opening the management URL directly
   redirects an authorized judge to that judging page.
5. Each judge, including the organizer, submits one finite score from 1 to 10
   per competitor. Accepted scores cannot be edited or individually deleted;
   removing their competitor or competition deletes them as part of the cascade.
6. The organizer opens Live Results: arithmetic averages, score counts, ties,
   and unscored competitors update automatically. Other judges' raw scores and
   the private organizer results view are not available to assigned judges.
7. Optionally enable **Public Results** from management, then copy/open its URL.
   Spectators visit `/live/:competitionId` without signing in. They see names,
   ranks, averages and counts; they cannot judge or manage the competition.
8. From management, revoke a judge while preserving accepted scores, remove a
   competitor together with their scores, or delete the entire competition.

## Architecture and responsibility

The frontend lives in `src/pages/`. Generouted maps file names to routes;
`(app)` and `(protected)` are layout groups, not URL segments. The static landing
page mounts no auth or record providers. The app layout mounts
`DeepSpaceAuthProvider`, `RecordProvider`, and `RecordScope`. The protected layout
uses `AuthGate`; the dashboard also has an auth gate.

`worker.ts` assembles the Hono routes and `AppRecordRoom`, which extends the
app-owned `PublicResultsRoom` projection coordinator. DeepSpace supplies
verified authentication, Durable Object SQLite record persistence, collection
permissions, WebSocket broadcasts, and synchronized `useQuery` state.
`src/constants.ts` gets the immutable app ID from the build and uses the shared
`app:<appId>` room. Display branding does not change that identity.

ScoreSpace supplies competition business rules: ownership checks, judge
assignments, validation, stable record IDs, immutable score policy, navigation,
and standings calculation. It uses no external integration API. The scaffold
contains other room bindings, but ScoreSpace does not use AI, presence, canvas,
collaborative documents, payments, or messaging.

| Collection | Meaning and access |
| --- | --- |
| `competitions` | Name; organizer is server-assigned `createdBy`. Owner or assigned team member can read. Members/admins can create; direct updates/deletes denied. |
| `competitors` | Name and immutable competition reference. Team-readable; only the authorized server action writes. |
| `team_members` | Judge assignment: `teamId` = competition ID, `UserId` = existing DeepSpace identity, `status` = active. Organizer-readable; server actions add/revoke assignments. |
| `scores` | Competitor/competition references and immutable value. `createdBy` identifies the judge; server-derived `organizerAccess` grants the organizer access to other judges' scores. `submitScore` creates records; organizer lifecycle cascades delete them. |
| `public_results` | Explicitly published, server-derived scoreboard: competition name and ordered competitor names, averages, counts, ranks and tie flags. Anonymous read allowed; all client writes denied. Envelope `createdBy` is a fixed service identity. |

`useUsers()` supplies the existing roster for the picker. The UI uses names and
IDs, not emails or a globally readable full-users query. Existing SDK admin
roster privileges are unchanged. Competition organizer is a per-record business
role, distinct from the app-wide DeepSpace admin role.

## Authorization and duplicates

Collection permissions apply to queries, record gets, and broadcasts. Frontend
filters and redirects are only presentation. An unrelated user receives no
private competition record, even with a guessed ID.

`src/server/action-routes.ts` verifies bearer authentication before dispatching
only explicitly registered actions. Action tools bypass collection RBAC, so:

- `addCompetitor` and `addJudge` load the competition and compare its `createdBy`
  with the verified caller before writing.
- `addJudge` validates the target's existing app-user record/role. Its primary
  key encodes the competition/user tuple, making repeated assignments idempotent.
- `submitScore` checks the competitor's parent, owner or persisted assignment,
  and finite numeric range. Caller identity and primary key never come from
  browser-supplied judge/record IDs.
- A score ID encodes `[verifiedUserId, competitorId]`. DeepSpace creation with
  an explicit ID is an upsert. Immutable fields allow identical retries but
  reject a different value, including concurrent submissions. A read-before-write
  duplicate check is not the concurrency boundary.
- Raw scores use collaborator permissions: author plus organizer. Owner-authored
  scores need no extra access list, preserving compatibility with older records.

DeepSpace 0.33.1 compatibility details are intentional: membership refresh reads
capitalized `UserId`; team SQL maps it to `col_userid`. A computed, read-only
competition ID (`_row_id`) makes parent team access work in both SQL queries and
broadcast checks without storing a second competition identity. Integration tests
cover both behaviors; recheck them when upgrading the SDK.

## Realtime and standings

Authorizing a judge persists a team record and prompts that user's existing
socket to resubscribe. Their open dashboard then receives the competition.

Score submission follows:

`verified action → authorization/validation → RecordRoom persistence → permitted
broadcast → useQuery changes → deriveStandings → React renders`

UI success waits for server acceptance. Record lists come from synchronized
queries, not an optimistic duplicate list or polling. Private results are derived
in the organizer's browser. Public results use a persisted, server-derived safe
projection because spectators must never receive the underlying private scores.
The judging query selects the current author's scores, including when that author
is also an organizer who is permitted to read others' scores.

`src/lib/standings.ts` groups scores by competitor, sorts values for deterministic
addition order, and calculates sum/count. Ranking uses unrounded JavaScript
numbers; exact equal values rank `1, 1, 3`. Unscored entries follow scored ones.
Integers display one decimal; other numbers retain their numeric representation.
Binary floating-point can produce long fractions or tiny differences between
mathematically equivalent decimal calculations; there is no decimal rounding rule.

## Public spectators and privacy

Publication is explicit and organizer-only. `publishResults` checks app membership
and forwards verified identity to a private DO route, which checks competition
ownership. A page visit cannot publish data. An absent public record yields the
same unavailable state whether a competition is missing or simply unpublished.

`src/pages/(spectator)/_layout.tsx` is outside the protected/app-management layout.
It uses the existing auth provider to finish SDK startup, but forces the record
connection to be anonymous even for an already signed-in visitor. The page uses
`useQuery('public_results')`; no login, roster, or private score query is required.
The current SDK may check the browser's session during startup; that is not a
requirement to sign in or a results-polling mechanism.

`PublicResultsRoom` coordinates privileged competitor/score/assignment creations,
lifecycle operations, native WebSocket messages, and public refreshes in one DO
queue. It rechecks parent ownership or current judge membership immediately before
persisting action writes, so earlier authorization cannot outlive a removal.
The server reads canonical private records, reuses `deriveStandings`, explicitly
allowlists public fields with `buildPublicResults`, and writes the projection
through DeepSpace's record API. Normal RecordRoom broadcasts update spectators'
queries. Owner/judge private subscriptions continue working as before.

A durable KV pending marker and a Durable Object alarm protect the gap between a
private write and its public projection. The marker is persisted before the
private mutation. A failed refresh does not undo an accepted immutable score;
the alarm retries after roughly 30 seconds, including after a room restart.
Successful operations refresh immediately. Recovery alarms run only for pending
work, not as periodic leaderboard polling. Projection lag is possible during a
failure; the public page does not claim a transactional cross-view snapshot.

Privacy means **no public raw records or judge identities**, not anonymity of the
math: an average with count 1 equals one score, and differences between successive
averages/counts can reveal a new value. Names and aggregates become intentionally
public and discoverable through the public collection; the URL is not a secret
capability. There is no unpublish/revoke feature, and public information cannot be
recalled from spectators. Only publish competitions whose names/results may be
shared. Each public record contains a whole scoreboard, appropriate for this
small app rather than an unbounded competition. Future competitor editing,
individual score deletion, ownership transfer, or additional write paths must update the
projection coordination rules.

## Organizer lifecycle and recovery

Three authenticated server actions (`removeJudge`, `removeCompetitor`, and
`deleteCompetition`) forward only validated IDs and the verified caller to a
private room route. The room loads the competition and compares `createdBy`
with that caller. App-wide admin status does not override competition ownership.
Targets must belong to that competition; collection permissions are unchanged.

- **Remove Judge:** deletes the deterministic `team_members` assignment only.
  The SDK sends a resubscribe notification, removing the competition/competitors
  from that judge's authorized queries. Future score submissions are rejected,
  including requests waiting to persist when revocation happened. Accepted scores
  and their aggregate contributions remain. Under the existing author ACL, a
  revoked judge can still read their own historical score records; revocation
  cannot recall data already delivered or hide intentionally public results.
- **Remove Competitor:** invalidates the public projection, deletes scores scoped
  to that competition and competitor, then deletes the competitor. If previously
  published (or publication was pending), it rebuilds sanitized results before
  confirming success. Other competitors and their scores remain untouched.
- **Delete Competition:** invalidates public results and clears publication intent,
  then deletes scores, competitors, assignments, and finally the competition.
  Successful cleanup removes its lifecycle marker. The organizer returns to
  `/home`; spectators see the existing unavailable state.

The UI uses destructive confirmation dialogs; competition deletion requires its
exact name. Server authorization remains mandatory regardless of UI confirmation.
SDK `records.delete`/`records.deleteWhere` preserve normal permission-filtered
broadcasts; bounded delete batches are drained until complete. `useQuery` updates
open clients without polling. Completion also requests fresh subscriptions to
recover a broadcast interrupted by a room restart.

Cascades are **resumable, not atomic**. Before deletion, a private
`lifecycle:pending:<competitionId>` KV marker records the operation, verified
owner, target, and publication intent. The existing DO alarm retries unfinished
work after roughly 30 seconds. Pending cleanup blocks new writes/publication for
that competition; an owner retry can resume the same operation even after the
parent was deleted. Missing records are harmless during recovery. No new
collections, permissions, external services, or SDK modifications are needed.

During cleanup, private views can briefly show partial deletion and the public
page can briefly show unavailable. If cleanup fails, the action reports pending
instead of success; the public projection stays unavailable once invalidated.
Persistent storage failures require investigation (`[lifecycle]` logs); recovery
cannot promise a fixed deadline. An empty scheduled alarm may fire once after
successful cleanup and does nothing. Deletion is permanent, with no undo, and
does not retract previously downloaded public data. The shared queue and full
scoreboard rebuild suit this small app, not an unbounded dataset.

## Local development

Use a Node version supported by `package.json` (for example Node 24) and npm 11.6+.

```sh
npm ci
npx deepspace auth whoami --json
# Only if signed out:
npx deepspace auth login
npm run dev
```

Open the local URL printed by the CLI. CLI developer login and browser user
sign-in are separate. `wrangler.toml` supplies the app identity and Durable Object
bindings. Do not replace the app ID or create another production configuration.

`.dev.vars` is a generated local cache, not a production configuration file.
It and `dist/` are ignored; never commit them. Manage secrets through
`npx deepspace secrets`, not source code. ScoreSpace requires no third-party keys.
DeepSpace supplies platform authentication/service bindings during deployment.

## Checks and manual verification

```sh
npm run type-check
npm run lint
npm run test:unit
npm run build
npx deepspace test run all --port 5187
git diff --check
```

Unit/integration tests include real installed RecordRoom + in-memory SQLite
permission, broadcast, and concurrency checks. Cloudflare sockets and platform
membership lookup are adapted/mocked; these are not full production-auth tests.
HTTP dispatcher tests use fake credentials and verify own-property dispatch.

Lifecycle integration tests additionally cover ownership refusals, preserved
historical scores, scoped cascades across multiple delete batches, delayed-write
races, interrupted deletion/projection recovery, and ID reuse during pending
cleanup. Current verification results are recorded in `SUBMISSION.md`; skipped
authenticated tests and the manual checklist below are not claimed as verified.

Authenticated browser specs require configured DeepSpace test accounts. The
runner reports skips when none are available; skipped tests are not verification.
Inspect `npx deepspace test accounts --help` to configure accounts without putting
passwords in source or command arguments.

Manual two-user checklist (separate browser profiles):

- A creates a competition and competitor. B cannot open its detail/judging URLs.
- B leaves the dashboard open. A adds B as judge; B sees the competition without
  refresh and its link opens judging directly.
- B manually opens the detail URL: it redirects to judging. Back returns to the
  dashboard. B has no management controls and cannot open results.
- A submits 8, then leaves results open. B still has their own empty score form.
  B submits 9.5; A sees average 8.75 and count 2 without refresh.
- Reload: each judging page shows only that user's accepted score, with no editing
  form. Results persist. Use a third unrelated user to repeat privacy checks.
- Before publication, open `/live/<competitionId>` in a signed-out window: it
  should say unavailable without asking for login.
- A enables Public Results and copies its URL. Open it in that window; verify
  names, ranks, counts, ties and unscored rows, with no management/judging controls.
- Keep the public page open while A/B score or A adds a competitor. It should
  update without reload; private organizer results should update too.
- Check spectator WebSocket frames: no `scores` records, judge IDs, roster, or
  private competitor IDs. Reload the spectator page and verify persistence.
- Repeat at a narrow viewport and check keyboard access to forms/navigation.
- With B's dashboard/judging page and a spectator page open, A removes B as judge.
  B loses the competition without refresh and cannot submit again; accepted scores,
  averages, and counts remain. Reassign B to verify their accepted score persists.
- Cancel competitor removal once, then confirm it. Check that competitor and all
  its scores disappear from management, private results, and the spectator page;
  another competitor's scores remain. Reload to check persistence.
- Create a second competition as a control. Delete the first by typing its name.
  Check A returns to the dashboard, B loses access, its public URL is unavailable
  before and after reload, and the control competition remains unchanged.
- Judges/unrelated users should have no lifecycle controls. In developer tools,
  repeat lifecycle requests with their credentials: the server must refuse them.

## Deployment

The spectator and lifecycle extensions are local-only until deliberately deployed. The earlier
Milestone 6 release was deployed at `https://scorespace.app.space`; that release
does **not** include this extension. No automatic commit or deployment is part
of the spectator-feature task.

`npx deepspace app source --json` reports the source authority;
`npx deepspace status --json` reports inference before the first release. This
checkout already has a GitHub origin, so the first deployment infers GitHub
source permanently. Preserve that existing remote. Under GitHub source,
`npx deepspace deploy` ships the current checkout (including uncommitted files);
it does not commit or push GitHub changes. Review the working tree before release
and commit/push separately using ordinary Git when ready.

For a separate checkout already using DeepSpace source, deploy instead requires
a clean committed branch. Do not switch source authorities or create another
app to work around a refusal. Production secrets come from the platform store,
not `.dev.vars`.

A successful deploy is not proof of signed-in behavior. Check the returned live
URL, static landing, dashboard sign-in, protected direct URLs, and the two-user
checklist above. Inspect `npx deepspace releases` and `npx deepspace logs` for
release/runtime evidence. Do not submit the exercise automatically.

## Limits and interview map

This is a small exercise: no invitations, ownership transfer, individual score
editing/deletion, rounds, criteria, unpublishing, or result finalization.
Ownership transfer would require revisiting membership and score ACLs.
No large-competition pagination/scale guarantee is provided. Existing records
are not copied from local development into production by deploying code.

Highest-value files to understand:

- `src/schemas/`: owner metadata, team access, and private raw-score permissions.
- `src/actions/add-judge.ts`: owner check, target verification, stable assignment ID.
- `src/actions/submit-score.ts`: parent/assignment validation and immutable upsert.
- `src/server/action-routes.ts`: verified identity and privileged tool boundary.
- `src/lib/standings.ts`: pure averages, counts, deterministic ties.
- `src/lib/competition-navigation.ts` and competition pages: role-aware
  destinations after permission-filtered reads; routing never grants access.
- `src/pages/(app)/_layout.tsx` and `worker.ts`: providers, room scope, server wiring.
- `src/actions/publish-results.ts`, `src/server/public-results-room.ts`, and
  `src/lib/public-results.ts`: publication ownership, serialized projection,
  durable recovery, and the boundary between raw private records and public data.
- `src/pages/(spectator)/`: anonymous realtime connection and public scoreboard.
- `src/actions/lifecycle.ts` and `src/server/public-results-room.ts`: validated
  lifecycle commands, ownership at persistence, cascade order and durable retries.
- `src/components/lifecycle-action.tsx`: confirmed requests and destructive dialogs;
  `src/server/public-results-room.test.ts`: authorization, concurrency and recovery evidence.

See `SUBMISSION.md` for an editable, explicit account of agent involvement and
personal-verification placeholders.
